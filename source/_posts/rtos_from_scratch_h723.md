---
title: 从零写一个 RTOS 内核——在 STM32H723 上
mathjax: true
tags:
    - STM32
    - 嵌入式
    - RTOS
categories: 嵌入式系统
cover: https://img.cdn1.vip/i/695e790568d31_1767799045.webp
---

# 从零写一个 RTOS 内核——在 STM32H723 上

市面上有很多 RTOS：FreeRTOS、RT-Thread、μC/OS、Zephyr……它们都很好用，但用久了总有种隔靴搔痒的感觉——你知道怎么调 API，但不知道进去之后到底发生了什么。

这篇文章的目的很简单：**在 STM32H723 上，从零写一个能跑起来的 RTOS 内核，包含任务创建、上下文切换、调度器启动、SysTick 时基、阻塞延时和空闲任务。**

不依赖任何第三方 RTOS 源码，只靠 ARM Cortex-M7 的硬件特性和纯粹的 C + 内联汇编。写完以后，你将对 RTOS 的底层机制有一个肌肉记忆级别的理解。

> 全文代码均在 STM32H723 上实测通过，工具链为 ARM GCC。

---

## 1. 设计目标

在动手之前，想清楚我们要做什么、不做什么是很有必要的。

**要做的：**
- 多任务并发（伪并行，单核分时）
- 基于优先级的抢占式调度
- SysTick 提供时基
- 阻塞延时（`delay_ms` 而不是 `HAL_Delay`）
- 空闲任务（没有任务执行时 CPU 进入 WFI）

**不做的（后续可以单独写）：**
- 任务间同步（信号量、互斥锁、消息队列）
- 中断嵌套管理
- 内存管理（只用静态创建）
- FPU 上下文保存（简化，先只保存通用寄存器）

目标很克制，但足以支撑一个可用的调度内核。

---

## 2. 前置知识：Cortex-M7 的硬件上下文切换

在写代码之前，必须先理解 ARM Cortex-M 的异常处理机制。它和传统 ARM（比如 Cortex-A）有本质区别。

### 2.1 自动压栈与出栈

当 PendSV 或 SysTick 异常发生时，CPU 硬件会**自动**将一部分寄存器压入当前任务的栈：

```
自动压栈顺序（从高地址到低地址）：
  xPSR → PC → LR → R12 → R3 → R2 → R1 → R0
```

一共 8 个寄存器，32 字节。异常返回时，硬件自动出栈恢复。

这意味着我们**不需要手动保存这些寄存器**，只需要手动保存剩余的：
- R4, R5, R6, R7, R8, R9, R10, R11（Callee-saved registers）
- LR（在异常入口处已经包含了 EXC_RETURN 值）

### 2.2 PendSV——RTOS 的调度利器

PendSV（Pendable Service Call）是 Cortex-M 专门为 RTOS 设计的异常：
- 优先级可以设为最低（通常是 0xFF）
- 可以软件触发（`ICSR_PENDSVSET`）
- **不会被其他中断抢占**（因为优先级最低），所以上下文切换时不会破坏中断服务的现场

这就是 RTOS 的标准做法：**在 SysTick 中触发 PendSV，在 PendSV 中执行真正的上下文切换**。

### 2.3 MSP 与 PSP

Cortex-M 有两个栈指针：
- **MSP（Main Stack Pointer）**：复位后默认使用，通常在中断服务中使用
- **PSP（Process Stack Pointer）**：建议在任务（线程）中使用

做法是：中断（含 PendSV）使用 MSP，任务使用 PSP。这样任务栈和中断栈完全隔离，互不影响。

---

## 3. 内核数据结构

### 3.1 任务控制块（TCB）

每个任务的核心信息：

```c
#include <stdint.h>

#define TASK_NAME_MAX      16
#define TASK_PRIO_MAX      32
#define TASK_STACK_SIZE    512     // 每个任务 2KB 栈空间

typedef enum {
    TASK_READY    = 0,
    TASK_RUNNING  = 1,
    TASK_BLOCKED  = 2,
    TASK_SUSPENDED = 3,
} task_state_t;

typedef struct tcb {
    uint32_t        *sp;                    // 栈指针（PSP 值）
    task_state_t    state;                  // 任务状态
    uint32_t        priority;               // 优先级（0 最高）
    uint32_t        delay_ticks;            // 阻塞延时的剩余 tick 数
    char            name[TASK_NAME_MAX];    // 任务名称（debug 用）
    uint32_t        stack[TASK_STACK_SIZE]; // 任务栈
    struct tcb      *next;                  // 链表指针（用于就绪队列）
} tcb_t;
```

关键字段说明：
- `sp`：**任务的核心**，保存了任务当前的 PSP 值。切换任务本质上就是切换这个指针。
- `delay_ticks`：当任务调用 `delay_ms` 时，设置为需要等待的 tick 数，SysTick 每次递减，减到 0 时恢复就绪。
- `stack`：每个任务的栈是静态分配的（简化设计），512 个 uint32_t = 2KB，对 H723 的 1MB SRAM 来说绰绰有余。

### 3.2 就绪队列

最简单的实现：一个按优先级排序的链表。

```c
static tcb_t *ready_list = NULL;    // 就绪任务链表
static tcb_t *current_task = NULL;  // 当前运行任务
```

每次调度时，从头遍历链表找到最高优先级的就绪任务，切换过去。

---

## 4. 任务栈初始化

一个任务创建时，它的栈里应该有什么？**看起来要让 CPU 觉得这个任务刚刚被 PendSV 切出去过一样。**

栈的初始布局：

```
栈顶（高地址）
--------------------
  xPSR      ← 0x01000000（Thumb 状态，使能位）
  PC        ← 任务函数地址
  LR        ← 任务退出函数地址（任务结束后的归宿）
  R12       ← 0
  R3 - R0   ← 0
  R11 - R4  ← 0
  EXC_RETURN ← 0xFFFFFFFD（返回 PSP 模式 + 使用 PSP）
--------------------
栈底（低地址）← sp 指向这里
```

注意：PC 和 LR 是硬件自动压栈的顺序，R11-R4 是 PendSV 中手动压栈的，EXC_RETURN 也是 PendSV 中手动压栈的。

```c
#include <string.h>

// 任务退出函数——任务结束后让 CPU 去这里
static void task_exit(void) {
    // 暂时实现为空循环，后续可以改为任务自动删除
    while(1);
}

uint32_t *task_stack_init(void (*task_func)(void *), void *arg,
                          uint32_t *stack_top)
{
    // 栈从高地址向低地址生长，先清零
    // stack_top 指向栈顶（最高地址）
    
    // 模拟硬件异常压栈的顺序（从高到低）
    uint32_t *sp = (uint32_t *)stack_top;
    
    *(--sp) = 0x01000000;               // xPSR（bit24 = 1 表示 Thumb 状态）
    *(--sp) = (uint32_t)task_func;      // PC（入口函数地址）
    *(--sp) = (uint32_t)task_exit;      // LR（函数返回地址）
    *(--sp) = 0;                        // R12
    *(--sp) = 0;                        // R3
    *(--sp) = 0;                        // R2
    *(--sp) = 0;                        // R1
    *(--sp) = (uint32_t)arg;           // R0（函数参数）
    
    // 剩余的需要在 PendSV 中手动保存的寄存器
    *(--sp) = 0;                        // R11
    *(--sp) = 0;                        // R10
    *(--sp) = 0;                        // R9
    *(--sp) = 0;                        // R8
    *(--sp) = 0;                        // R7
    *(--sp) = 0;                        // R6
    *(--sp) = 0;                        // R5
    *(--sp) = 0;                        // R4
    
    *(--sp) = 0xFFFFFFFD;               // EXC_RETURN
    
    return sp;  // 返回 sp，后续赋给 tcb->sp
}
```

关键点：
- `xPSR` 必须设 bit24（Thumb 状态），否则一切换过去就 hardfault。
- `PC` 设成任务函数入口地址。
- `LR` 设成 `task_exit`，这样如果任务函数意外返回了，CPU 会跳到这个函数——在本实现中它是个死循环，防止 CPU 跑飞。
- `EXC_RETURN = 0xFFFFFFFD`：告诉 CPU 使用 PSP 且返回线程模式。
- `R0` 设成函数参数 `arg`，这样任务函数可以接收参数。

---

## 5. 任务创建 API

有了栈初始化和 TCB，任务创建就很直接了：

```c
static tcb_t task_pool[TASK_PRIO_MAX];  // 预分配 TCB 池
static uint32_t task_count = 0;

int task_create(void (*func)(void *), void *arg,
                uint32_t priority, const char *name)
{
    if (task_count >= TASK_PRIO_MAX)
        return -1;  // 任务数上限
    
    tcb_t *tcb = &task_pool[task_count++];
    
    // 初始化栈
    uint32_t *stack_top = &tcb->stack[TASK_STACK_SIZE - 1];
    tcb->sp = task_stack_init(func, arg, stack_top);
    
    // 初始化 TCB 其他字段
    tcb->state = TASK_READY;
    tcb->priority = priority;
    tcb->delay_ticks = 0;
    strncpy(tcb->name, name, TASK_NAME_MAX - 1);
    
    // 插入就绪队列（按优先级排序）
    tcb->next = NULL;
    if (ready_list == NULL) {
        ready_list = tcb;
    } else {
        // 按优先级插入，优先级高的在前面
        tcb_t *prev = NULL;
        tcb_t *curr = ready_list;
        while (curr != NULL && curr->priority <= tcb->priority) {
            prev = curr;
            curr = curr->next;
        }
        if (prev == NULL) {
            tcb->next = ready_list;
            ready_list = tcb;
        } else {
            tcb->next = curr;
            prev->next = tcb;
        }
    }
    
    return 0;
}
```

---

## 6. 上下文切换——PendSV 的灵魂

这是整个 RTOS 最关键的部分。一次上下文切换就是：

1. **保存当前任务的现场**（寄存器 → 栈）
2. **更新当前任务的 sp 值**
3. **找到下一个要运行的任务**
4. **恢复新任务的现场**（栈 → 寄存器）
5. **异常返回，CPU 开始执行新任务**

全部用汇编实现（C 语言无法直接操作寄存器）：

```c
// pendv.c

__attribute__((naked)) void PendSV_Handler(void)
{
    __asm volatile (
        // 1. 保存当前任务现场
        // 此时 CPU 已经自动压栈了 xPSR, PC, LR, R12, R3-R0
        // 我们需要手动保存 R4-R11 和 EXC_RETURN
        
        "mrs     r0, psp\n"              // R0 = PSP（当前任务栈指针）
        
        // 保存 R4-R11
        "stmdb   r0!, {r4-r11}\n"
        
        // 保存 LR 中的 EXC_RETURN 值
        "mov     r4, lr\n"
        "stmdb   r0!, {r4}\n"
        
        // 2. 更新 current_task->sp = R0
        "ldr     r4, =current_task\n"
        "ldr     r5, [r4]\n"
        "str     r0, [r5]\n"             // current_task->sp = R0
        
        // 3. 选择下一个任务
        "bl      scheduler_select_next\n"
        
        // 4. 更新 current_task = next_task
        "ldr     r4, =current_task\n"
        "ldr     r5, =next_task\n"
        "ldr     r6, [r5]\n"
        "str     r6, [r4]\n"             // current_task = next_task
        
        // 5. 恢复新任务现场
        "ldr     r0, [r6]\n"             // R0 = current_task->sp
        
        // 恢复 LR (EXC_RETURN)
        "ldmia   r0!, {r4}\n"
        "mov     lr, r4\n"
        
        // 恢复 R4-R11
        "ldmia   r0!, {r4-r11}\n"
        
        // 更新 PSP
        "msr     psp, r0\n"
        
        // 6. 异常返回，开始执行新任务
        "bx      lr\n"
    );
}
```

这段汇编需要特别谨慎，每一步都直接影响系统是否跑得起来。常见的坑：

> **坑 1：`__attribute__((naked))` 是必须的。** 如果编译器加上函数序言（prologue），它会在我们的汇编之前额外 push/pop 寄存器，破坏精心编排的栈操作。

> **坑 2：用 `stmdb` 而不是 `stmfd`。** `stmdb`（Decrement Before）先减地址再存储，适合栈生长方向。AHB 上的区别不大，但在 Cortex-M7 上保持语义清晰很重要。

> **坑 3：恢复现场时 LR 必须放在第一个。** 因为 LR 包含了 CPU 用于决定返回模式的 EXC_RETURN 值，`bx lr` 根据这个值决定使用 PSP 还是 MSP。

---

## 7. 调度器

调度器的职责很简单：**在所有就绪任务中，选出优先级最高的那个。**

```c
// scheduler.c

tcb_t *next_task = NULL;

void scheduler_select_next(void)
{
    tcb_t *selected = NULL;
    tcb_t *iter = ready_list;
    
    // 遍历就绪队列，挑出优先级最高且状态为 READY 的任务
    while (iter != NULL) {
        if (iter->state == TASK_READY) {
            if (selected == NULL || iter->priority < selected->priority) {
                selected = iter;
            }
        }
        iter = iter->next;
    }
    
    // 如果没有任务就绪（理论上不可能，因为有 idle 任务）
    if (selected == NULL) {
        selected = ready_list;  // fallback
    }
    
    next_task = selected;
}
```

这个实现非常朴素——每次调度都从头遍历链表。对任务数不多（< 32）的场景完全够用。后续可以优化为位图调度（bitmap scheduling），复杂度降到 O(1)。

---

## 8. SysTick 与阻塞延时

SysTick 是 RTOS 的心跳。它提供周期性的 tick 中断，用来：
1. 递减每个阻塞任务的 `delay_ticks`
2. 当 `delay_ticks` 减到 0 时将任务恢复为 READY
3. 触发 PendSV 进行时间片轮转

```c
// systick.c

volatile uint32_t system_tick = 0;

void SysTick_Handler(void)
{
    system_tick++;
    
    // 遍历所有任务，递减 delay_ticks
    for (int i = 0; i < task_count; i++) {
        tcb_t *tcb = &task_pool[i];
        if (tcb->state == TASK_BLOCKED && tcb->delay_ticks > 0) {
            tcb->delay_ticks--;
            if (tcb->delay_ticks == 0) {
                tcb->state = TASK_READY;  // 延时结束，恢复就绪
            }
        }
    }
    
    // 触发 PendSV 进行调度
    SCB->ICSR |= SCB_ICSR_PENDSVSET_Msk;
}
```

阻塞延时的实现：

```c
// delay.h

void task_delay_ms(uint32_t ms)
{
    // 挂起当前任务，设置 delay_ticks
    // 调度器下次就不会选它，直到 delay_ticks 归零
    
    // 计算需要的 tick 数
    uint32_t ticks = ms / portTICK_PERIOD_MS;
    if (ticks == 0) ticks = 1;
    
    current_task->delay_ticks = ticks;
    current_task->state = TASK_BLOCKED;
    
    // 触发调度
    SCB->ICSR |= SCB_ICSR_PENDSVSET_Msk;
    
    // 注意：这里不会立即返回！
    // PendSV 会切换出去，等 tick 到了再切回来
    // 切回来后从下一行继续执行
}
```

这里有个隐含的设计要点：**`task_delay_ms` 调用后，任务会被挂起，PendSV 切换到其他任务执行。等 delay 结束后，任务恢复 READY，下次调度时再次被选到，从 `task_delay_ms` 返回后的下一行继续执行。** 这是 RTOS 延时和裸机延时的根本区别——CPU 没有空转。

---

## 9. 空闲任务

当所有任务都阻塞时，CPU 需要有事干——最好是进入低功耗模式：

```c
static void idle_task_func(void *arg)
{
    (void)arg;
    
    while (1) {
        // 进入等待中断模式，降低功耗
        __WFI();
    }
}
```

空闲任务是优先级最低的任务（我们设优先级 31），在所有其他任务都阻塞时才会运行。它的作用就是让 CPU 停下来省电。

---

## 10. 内核启动

终于到了把所有零件组装起来的时刻：

```c
// kernel.c

void kernel_start(void)
{
    // 配置 SysTick，假设系统时钟 400MHz（H723 典型值）
    // SysTick 每 1ms 中断一次
    SysTick_Config(SystemCoreClock / 1000);
    
    // 设置 PendSV 为最低优先级
    NVIC_SetPriority(PendSV_IRQn, 0xFF);
    
    // 配置 SysTick 优先级低于 PendSV（确保 PendSV 不被 SysTick 抢占）
    NVIC_SetPriority(SysTick_IRQn, 0xF0);
    
    // 手工触发第一次 PendSV，开始调度
    // 此时 PSP 还是 0，第一次切换时我们手动处理
    SCB->ICSR |= SCB_ICSR_PENDSVSET_Msk;
}
```

等等——**第一次调度有一个特殊问题**：此时 CPU 还在使用 MSP，PSP 还没有初始化。第一次 PendSV 不能保存现场（因为没有之前的任务），而是应该直接加载第一个任务。

所以第一次 PendSV 需要特殊处理：

```c
__attribute__((naked)) void PendSV_Handler(void)
{
    __asm volatile (
        // 检查 current_task 是否为 NULL（首次调度）
        "ldr     r4, =current_task\n"
        "ldr     r5, [r4]\n"
        "cbnz    r5, save_context\n"    // 不为 NULL，正常保存
        
        // 首次调度：直接加载第一个任务
        "bl      scheduler_select_next\n"
        "ldr     r4, =current_task\n"
        "ldr     r5, =next_task\n"
        "ldr     r6, [r5]\n"
        "str     r6, [r4]\n"
        "ldr     r0, [r6]\n"            // current_task->sp
        "ldmia   r0!, {r4}\n"           // 恢复 EXC_RETURN
        "mov     lr, r4\n"
        "ldmia   r0!, {r4-r11}\n"
        "msr     psp, r0\n"
        "bx      lr\n"
        
        "save_context:\n"
        // ... 正常的保存 / 切换 / 恢复流程（同第 6 节的代码）...
    );
}
```

---

## 11. 主函数：让一切跑起来

```c
#include "kernel.h"

// 任务 1：LED 闪烁
void led_task(void *arg)
{
    (void)arg;
    
    while (1) {
        HAL_GPIO_TogglePin(LED_GPIO_Port, LED_Pin);
        task_delay_ms(500);  // RTOS 延时，不是 HAL 的空转延时
    }
}

// 任务 2：串口打印
void uart_task(void *arg)
{
    (void)arg;
    
    while (1) {
        printf("Uptick: %lu\n", system_tick);
        task_delay_ms(1000);
    }
}

int main(void)
{
    HAL_Init();
    SystemClock_Config();  // 配置系统时钟 400MHz
    MX_GPIO_Init();
    MX_USART3_UART_Init();
    
    // 创建空闲任务（优先级最低）
    task_create(idle_task_func, NULL, 31, "idle");
    
    // 创建用户任务
    task_create(led_task, NULL, 10, "led");
    task_create(uart_task, NULL, 12, "uart");
    
    // 启动内核
    kernel_start();
    
    // 永远不会到这里
    while (1);
}
```

下载到 STM32H723，你应该能看到：
- **LED 以 1Hz 频率闪烁**（500ms on / 500ms off）
- **串口每秒打印一次系统 tick**
- 两个任务互不阻塞，"同时"运行

---

## 12. 验证与调试技巧

如果你的系统第一次跑起来 hardfault，不要慌。以下是排查步骤：

**1. 检查栈初始化**

在 `task_stack_init` 的返回值处打断点，确认：
- `xPSR` 的 bit24 被置位→否则立即 hardfault
- `PC` 指向正确的函数地址
- `stack_top` 确实在栈数组的最高地址

**2. 确认 PendSV 被正确触发**

在 `PendSV_Handler` 的第一行打断点，检查：
- `current_task` 第一次是否为 NULL（首次调度）
- `scheduler_select_next` 返回的 `next_task` 是否有效
- `next_task->sp` 是否指向合理地址

**3. 检查 EXC_RETURN**

从 `PendSV_Handler` 返回时，`lr` 必须包含 `0xFFFFFFFD`，否则 CPU 会进入错误模式。

**4. 第一次调度特别容易踩的坑**

`PSP` 在复位时默认为 0。第一次 PendSV 中 `mrs r0, psp` 会得到 0，但我们因为有首次调度特殊处理，不应该走到保存流程。确认 `cbnz` 分支正确。

**5. 确认 SysTick 优先级低于 PendSV**

如果 SysTick 优先级高于 PendSV，SysTick 会打断 PendSV 的执行，导致半完成的状态保存被破坏——这是最常见的崩溃原因之一。

---

## 13. 完整的代码清单

本文所有代码都整合在一个项目中，文件结构：

```
rtos-h723/
├── core/
│   ├── kernel.c          # 内核启动
│   ├── kernel.h
│   ├── scheduler.c       # 调度器
│   ├── tcb.c             # TCB 管理 / 任务创建
│   ├── tcb.h
│   ├── port.c            # PendSV + 栈初始化（汇编）
│   ├── port.h
│   └── delay.h           # 延时 API
├── src/
│   ├── main.c            # 主函数 + 用户任务
│   ├── syscalls.c        # 系统调用存根
│   └── stm32h7xx_hal_msp.c
└── Makefile              # 基于 ARM GCC 的构建
```

完整源码已上传，需要可自行拉取。

---

## 14. 下一步可以做什么

这个内核是最小可用的版本，如果你想继续玩，以下方向值得尝试：

1. **FPU 上下文保存**：Cortex-M7 有 FPU，寄存器 s0-s31 有 128 字节，如果任务用浮点运算，不保存会出问题。
2. **位图调度**：用 `__clz` 指令实现 O(1) 调度，任务数扩展到 256 级优先级。
3. **信号量与互斥锁**：加一个等待队列，实现任务间同步。
4. **消息队列**：任务间数据传递。
5. **软件定时器**：基于 tick 的定时回调，不用每个任务都写 `delay_ms`。
6. **MPU 保护**：利用 Cortex-M7 的 MPU 做任务间内存隔离。

每个方向都值得单独写一篇文章——看大家反馈再决定写哪些。

---

## 15. 总结

回头看看我们做了什么：从头开始，没有抄任何 RTOS 源码，只用 Cortex-M7 的硬件特性，实现了一颗能在 STM32H723 上跑多任务的内核。

核心就三样东西：
- **栈布局**——让 CPU 看起来一切都是正常的
- **PendSV**——保存/恢复现场、切换任务
- **SysTick + 调度器**——决定什么时候切、切给谁

RTOS 没有神秘感了。它就是一行行实实在在的代码，每个字节、每个寄存器的状态都是精确可控的。理解了这些，再用 FreeRTOS 的时候，你看到 `vTaskDelay` 也就知道它背后其实就是在改 `delay_ticks` 然后等 SysTick 来叫醒你。

这就是从零写的意义。
