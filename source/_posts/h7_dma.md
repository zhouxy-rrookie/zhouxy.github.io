---
title: STM32H723 的 DMA 与 RAM 冲突问题：从内存域、总线矩阵到 D-Cache
mathjax: true
tags:
    - STM32
    - 嵌入式
categories: 嵌入式系统
cover: https://img.cdn1.vip/i/69c8c42418811_1774765092.webp
---

# 前言

如果你在 STM32H723 上遇到过这些诡异现象：

- `HAL_UART_Receive_DMA()` 正常返回，但缓冲区就是不变
- ADC + DMA 偶尔全 0，偶尔又像是“好了”
- 把数组改成全局变量、`static`、甚至改个大小，结果症状跟着变
- 关掉 D-Cache 以后突然一切正常，重新打开又开始抽风

那大概率不是你“DMA 配错了一点点”，而是你踩中了 STM32H7 这一代 MCU 最经典的坑之一。

STM32H723 和很多 F1/F4/F7 的直觉式用法不太一样。它的 Cortex-M7 内核带有 32 KB I-Cache 和 32 KB D-Cache，同时系统内部又分成 D1 / D2 / D3 三个域，既有 AXI SRAM，也有 D2 SRAM、D3 SRAM，还保留了 ITCM / DTCM 这样的 TCM 内存路径。（见 [DS13313], [AN4891]）

所以，很多人口中的“DMA 与 RAM 冲突”，其实往往不是“两个模块抢内存”这么朴素，而是下面三类问题混在了一起：

1. **DMA 根本到不了那块 RAM**
2. **DMA 能到，但 CPU 的 D-Cache 让双方看到的不是同一份数据**
3. **大家都能到，但多个主设备并发访问时，真的发生了总线仲裁和带宽竞争**

这篇文章就把这件事从底层结构到工程修复，一次讲清楚。毕竟人类在调 DMA 这件事上浪费的时间，已经多到足够再造几块板子了。

---

# 一句话结论

> 在 STM32H723 上，所谓 “DMA 与 RAM 冲突”，最常见的根因并不是 RAM 坏了，而是 **Buffer 放错了内存域**，或者 **Buffer 放对了，但 Cache 一致性没处理**。

如果只记一条，请记这条：

- **DTCM 很快，但普通 DMA1/DMA2/BDMA 不可见**
- **AXI SRAM / SRAM1 / SRAM2 / SRAM4 可以给 DMA 用，但开了 D-Cache 以后必须处理一致性**
- **BDMA 只活在 D3 世界里，别把它往别的域乱塞**

这不是玄学，是架构决定的。（见 [AN4891], [ST-DMA-FAQ], [AN4839]）

---

# 1. 先把地图看明白：H723 到底有哪些 RAM

STM32H723 的内部 RAM 不是“一整坨”，而是分散在不同的总线和域上。数据手册给出的 H723 RAM 规模包括：

- 128 到 320 KB 的 AXI SRAM，位于 D1 域
- 16 KB 的 SRAM1，位于 D2 域
- 16 KB 的 SRAM2，位于 D2 域
- 16 KB 的 SRAM4，位于 D3 域
- 128 KB 的 DTCM RAM
- 一部分可在 ITCM 与 AXI SRAM 之间按 64 KB 粒度复用的共享 RAM

（见 [DS13313], [AN4891]）

下面给一个工程上更好记的表：

| 区域 | 典型基地址 | H723 规模 | 典型用途 | 适不适合做普通 DMA Buffer |
| --- | --- | --- | --- | --- |
| DTCM RAM | `0x20000000` | 128 KB | 栈、热点数据、ISR 高频数据 | **不适合**，普通 DMA1/DMA2/BDMA 看不到 |
| AXI SRAM | `0x24000000` | 128 到 320 KB | 大块缓冲、高带宽数据 | **适合**，但要管 D-Cache |
| SRAM1 | `0x30000000` | 16 KB | D2 外设的本地缓冲 | **适合**，但要管 D-Cache |
| SRAM2 | `0x30004000` | 16 KB | D2 外设的本地缓冲 | **适合**，但要管 D-Cache |
| SRAM4 | `0x38000000` | 16 KB | D3/BDMA 相关缓冲 | **适合**，尤其适合 D3/BDMA 场景 |

> 这里故意没把 ITCM 列进“普通 DMA Buffer”候选项，因为它本来就不是拿来干这个的。别硬来，MCU 不会因此对你产生敬意。

从架构上看，STM32H72x/H73x 使用三个独立总线矩阵：D1 域是 64-bit AXI，D2 和 D3 域是 32-bit AHB。这样设计是为了支持多主设备并行访问并减少总线拥塞，但“并发能力更强”并不等于“任何主设备都能访问任何 RAM”。（见 [AN4891]）

---

# 2. 第一类坑：Buffer 放进了 DTCM，DMA 根本摸不到

这是最常见、也最容易把人气笑的错误。

AN4891 明确写到，在 STM32H72x/H73x 架构里，**连接在 ITCM / DTCM 接口上的内存，只有 Cortex-M7 CPU 和 MDMA 能访问**。对普通 DMA1 / DMA2 来说，DTCM 不是“访问效率低”，而是**根本不在它的可达路径上**。（见 [AN4891]）

数据手册对 H723 也给出了同样的结论：DTCM / ITCM 是通过 TCM 接口提供给 CPU 使用的，MDMA 可以通过 Cortex-M7 的特定 AHB slave 访问这些区域。（见 [DS13313]）

所以你一旦把 DMA Buffer 放在 DTCM 里，就会出现非常典型的现象：

- DMA 配置看起来没问题
- 中断可能都来了
- 外设状态寄存器也像是在工作
- 但目标数组就是不更新，或者数据莫名其妙

这类问题在 STM32H7 上之所以高发，是因为 ST 自己的 FAQ 都专门点名了：**有些工程和示例会默认把内存放到 DTCM**，而 D1/D2 外设的 DMA 并不能访问这块内存。（见 [ST-DMA-FAQ]）

## 一个简单到近乎粗暴的判断方法

先别急着怀疑外设时序，先打印一下 Buffer 地址。

如果你的 DMA 缓冲区地址落在 `0x20000000` 这一段，那就先别讨论别的了，先把它挪出去。  
在 H723 上，这里首先该怀疑的就是 DTCM。

---

# 3. 第二类坑：Buffer 挪到了 AXI/D2/D3 SRAM，但 D-Cache 仍然会害你

很多人修到这一步，会以为问题已经结束：

> “我都把数组从 `0x20000000` 挪到 `0x30000000` 了，怎么数据还是不对？”

原因是，H723 的 Cortex-M7 带 D-Cache，而在 MPU 未配置时，Cortex-M7 默认地址映射会把 SRAM 区域当作 cacheable 的 normal memory，策略是 write-back / write-allocate。（见 [AN4839], [AN4891]）

这就带来两个经典场景：

## 场景 A：CPU 先写 Buffer，DMA 再去读

例如 UART/SPI/I2S 发送场景：

1. CPU 把待发送数据写进 SRAM
2. 这些新数据可能还只停留在 D-Cache 里，没有立刻回写到真正的 SRAM
3. DMA 去读 SRAM 时，读到的还是旧内容
4. 结果就是“发出去的数据不对”

AN4839 直接把这个问题讲得很明白：当内存区域使用 write-back cache 策略时，CPU 的写入可能被缓存，DMA 读到的不是 CPU 刚刚写进去的值。官方给出的解决方式之一，就是在 DMA 启动前对相应地址做 D-Cache clean。（见 [AN4839]）

## 场景 B：DMA 先写 Buffer，CPU 再去读

例如 ADC / UART RX / SPI RX 场景：

1. DMA 把新数据写回 SRAM
2. 但 CPU 之前已经把这块地址缓存进 D-Cache 了
3. CPU 读到的还是缓存里的旧数据
4. 结果就是“DMA 明明完成了，数组看起来却没变化”

AN4839 同样给出的官方建议是：**在 CPU 读取 DMA 刚写完的内存前，先做 D-Cache invalidate**，让 CPU 下次读取时重新从 SRAM 拿数据。（见 [AN4839]）

## 一个非常好记的口诀

> **CPU 写，DMA 读：先 Clean**  
> **DMA 写，CPU 读：先 Invalidate**

这条不神秘，就是 Cache 一致性的最小常识。（见 [AN4839], [CMSIS-DCache]）

---

# 4. 第三类坑：这次真的是“争用”，但它通常不是第一个要怀疑的锅

AN4891 说明，STM32H72x/H73x 之所以拆成多套总线矩阵，就是为了支持多主设备并发访问，并通过内部仲裁器解决冲突；D2/D3 的 AHB 矩阵也会对并发访问做仲裁，使用 round-robin 算法。（见 [AN4891]）

所以，**总线竞争是客观存在的**。如果你同时让 CPU、DMA1、DMA2、ETH、USB、SDMMC 之类的主设备一起对同一片 SRAM 高强度访问，确实可能出现：

- 吞吐下降
- FIFO overrun / underrun
- 某些帧偶发超时
- 高频实时任务抖动

但在工程上，真正的“DMA 完全不工作”或者“搬运结果全错”这类症状，优先级最高的排查方向依旧是前两类：

1. **地址是不是掉进 DTCM 了**
2. **D-Cache 一致性是不是没处理**

因为这两类问题最致命、最稳定、也最常见。  
至于总线竞争，更像是你把前两类都修完之后，系统在高负载下才暴露出来的第二阶段问题。

---

# 5. 不同 RAM 区到底该怎么用

如果只谈“能不能跑”，很多放法都能凑合。  
但如果你想让工程更稳定，最好从一开始就把 RAM 分工想清楚。

## 5.1 DTCM：给 CPU 私有热点数据，不给普通 DMA

DTCM 的优点是快、确定性高、零等待状态，适合：

- 栈
- 高频 ISR 数据
- 数学计算中的热点变量
- 对延迟特别敏感的控制数据

但它不适合做 DMA1/DMA2/BDMA 的普通缓冲区。  
如果你非要让外设链路和 DTCM 之间搬数据，正确角色通常不是 DMA1/2，而是 **MDMA 作为桥**。（见 [DS13313], [AN4891]）

## 5.2 SRAM1 / SRAM2：给 D2 外设 DMA 做“本地缓冲”

AN4891 专门提到，对 H72x/H73x 来说，D2 域的 SRAM1 和 SRAM2 可以作为位于 D2 域的本地 DMA 缓冲区；而且每块 SRAM 都有各自的 AHB 通路，这有助于减少并发访问时的总线争用。（见 [AN4891]）

这意味着如果你在做：

- USART + DMA
- SPI/I2C + DMA
- ADC + DMA
- 一些典型 D2 通信外设的数据流

那么把 Buffer 放在 `SRAM1 / SRAM2` 往往是很稳妥的选择。

## 5.3 AXI SRAM：给大块缓冲和高带宽链路

AXI SRAM 在 D1 域，容量更大，适合：

- 大块图像/音频缓冲
- USB / Ethernet / SDMMC 一类更偏“大块搬运”的数据区
- 需要被 D1 / D2 主设备共同访问的大缓冲区

但它通常也是更容易和 Cache 打架的地方。  
所以 AXI SRAM 不是“拿来就用”的万能区，而是“适合做 DMA 大缓冲，但必须管住 Cache”的区域。（见 [AN4891], [AN4839]）

## 5.4 SRAM4：给 D3 / BDMA 相关场景

AN4891 明确指出：

- SRAM4 位于 D3 域
- D2 域的 DMA1 / DMA2 可以经由 D2-to-D3 访问它
- **BDMA 只能访问 D3 域资源**

这句话的潜台词非常重要：

> 如果你在用 BDMA，缓冲区就别往 AXI SRAM 或 DTCM 里塞了，优先考虑 SRAM4。

否则你以为是“DMA 配置不对”，实际上是你让一个只会在 D3 里活动的搬运工，去 D1/DTCM 仓库扛货。（见 [AN4891]）

---

# 6. 实战上怎么修：一个稳妥的工程模板

下面给一个在 CubeIDE / GCC 工程里相对稳妥的思路。

## 6.1 先在链接脚本里单独开一个 DMA Buffer 段

以 `.ld` 为例，把一段专门给 DMA 的 section 放到 `RAM_D2`：

```ld
/* 只示意关键段，具体 MEMORY 名称以你的工程脚本为准 */

.dma_buffer :
{
    . = ALIGN(32);
    *(.dma_buffer)
    . = ALIGN(32);
} >RAM_D2
```

如果你是 D3 / BDMA 场景，就把它改成 `>RAM_D3`。  
如果是大块高带宽缓冲，比如网络帧或大块接收区，也可以考虑 `>RAM_D1`。

## 6.2 变量显式放段，并做 32 字节对齐

CMSIS 的 D-Cache 按地址维护接口要求地址按 32 字节边界对齐，因此 DMA Buffer 显式做 32 字节对齐是个很值得养成的习惯。（见 [CMSIS-DCache]）

```c
__attribute__((section(".dma_buffer"), aligned(32)))
static uint8_t uart_rx_buf[512];

__attribute__((section(".dma_buffer"), aligned(32)))
static uint8_t uart_tx_buf[512];
```

## 6.3 封装 Cache 维护函数，别每次手写

CMSIS 文档明确写了：`SCB_CleanDCache_by_Addr()` 和 `SCB_InvalidateDCache_by_Addr()` 的地址参数需要按 32 字节边界对齐。（见 [CMSIS-DCache]）

所以，最稳妥的做法不是“每次手工算一下”，而是自己封装一层：

```c
#include <stdint.h>
#include <stddef.h>
#include "core_cm7.h"

#define CACHE_LINE_SIZE 32U

static inline void dcache_clean_by_addr(const void *addr, size_t len)
{
    uintptr_t start = (uintptr_t)addr & ~(CACHE_LINE_SIZE - 1U);
    uintptr_t end   = ((uintptr_t)addr + len + CACHE_LINE_SIZE - 1U) & ~(CACHE_LINE_SIZE - 1U);
    SCB_CleanDCache_by_Addr((volatile void *)start, (int32_t)(end - start));
}

static inline void dcache_invalidate_by_addr(void *addr, size_t len)
{
    uintptr_t start = (uintptr_t)addr & ~(CACHE_LINE_SIZE - 1U);
    uintptr_t end   = ((uintptr_t)addr + len + CACHE_LINE_SIZE - 1U) & ~(CACHE_LINE_SIZE - 1U);
    SCB_InvalidateDCache_by_Addr((volatile void *)start, (int32_t)(end - start));
}
```

## 6.4 发送和接收分别怎么用

### 发送：CPU 写完，启动 DMA 前 Clean

```c
memcpy(uart_tx_buf, src, tx_len);
dcache_clean_by_addr(uart_tx_buf, tx_len);
HAL_UART_Transmit_DMA(&huart1, uart_tx_buf, tx_len);
```

### 接收：DMA 写完，CPU 读之前 Invalidate

```c
HAL_UART_Receive_DMA(&huart1, uart_rx_buf, sizeof(uart_rx_buf));

void HAL_UART_RxCpltCallback(UART_HandleTypeDef *huart)
{
    dcache_invalidate_by_addr(uart_rx_buf, sizeof(uart_rx_buf));
    /* 此后再去解析 uart_rx_buf */
}
```

如果你用的是 half-transfer / circular DMA，同样的原则不变，只是对“半缓冲”或“当前有效窗口”分别做 invalidate 即可。

## 6.5 如果 DMA 很频繁，考虑直接用非 Cache 区

AN4839 给出的官方思路之一，就是把 DMA Buffer 放到 non-cacheable 区，或者通过 MPU 把对应区域设成 write-through / shared，从而减少软件手工维护 Cache 的负担。（见 [AN4839]）

实际工程里，如果某块 Buffer：

- 更新频繁
- 数据量大
- 又被多个回调和任务来回使用

那直接给它单独开一块 non-cacheable 区，往往比到处 `Clean/Invalidate` 更不容易出事故。

---

# 7. 很多人会漏掉的两个细节

## 7.1 SRAM1 / SRAM2 不是永远默认可用

AN4891 还提到：复位后 SRAM1 / SRAM2 / SRAM3 的时钟默认是关闭的，需要通过 `RCC_AHB2ENR` 打开相应使能位后才能访问。（见 [AN4891]）

这件事在“完全照着 Cube 自动生成工程走”的情况下通常不太容易暴露；但如果你：

- 自己改了启动流程
- 裸机手写初始化
- 提前把 `.data/.bss` 或特殊段搬进 D2 RAM

那就别忘了确认这件事。  
不然你可能会把问题误判成“链接脚本炸了”或者“启动文件有毒”。

## 7.2 关掉 D-Cache 只是验证手段，不是优雅答案

AN4839 的例子很直接：关闭 D-Cache 时，DMA 相关数据搬运可以正常；开启 D-Cache 后，如果不处理一致性，就会出现数据不匹配。（见 [AN4839]）

所以，**临时关 D-Cache** 非常适合做定位：

- 关了就好，说明你多半是 Cache 一致性问题
- 关了也不好，那就继续回头查地址和内存域

但把 D-Cache 永久关掉，通常只是“先让它别坏”，不是“从架构上做对”。  
你买 H723 不是为了把 Cortex-M7 当没 Cache 的老 MCU 用的，虽然很多项目最后确实活成了这样。

---

# 8. 一套非常实用的排查顺序

以后再碰到 STM32H723 的 DMA 异常，可以按下面这个顺序排：

## 第一步：先看 Buffer 地址

- `0x20000000` 一带，先怀疑 DTCM
- `0x24000000` 一带，通常是 AXI SRAM
- `0x30000000` / `0x30004000`，通常是 SRAM1 / SRAM2
- `0x38000000`，通常是 SRAM4

不要一上来翻 HAL 源码。先问“这块内存 DMA 到底能不能到”。

## 第二步：确认当前有没有开 D-Cache

如果开了 D-Cache，而 Buffer 又在 AXI SRAM / SRAM1 / SRAM2 / SRAM4 这些可被 DMA 访问的 SRAM 里，那么就必须继续问下一句：

> 这次是 **CPU 写后 DMA 读**，还是 **DMA 写后 CPU 读**？

然后决定是 `Clean` 还是 `Invalidate`。

## 第三步：确认 DMA 控制器属于哪个域

- DMA1 / DMA2 主要活在 D2
- BDMA 只活在 D3
- MDMA 才是那个能碰 TCM、适合做跨域桥接的角色

控制器选错了，Buffer 再怎么挪也只是盲修。

## 第四步：最后才去怀疑真正的带宽竞争

如果前面都确认没问题，只在高吞吐、并发外设、满速场景下偶发异常，再去考虑：

- Buffer 是否都堆在同一片 SRAM
- CPU 是否在高频扫描 DMA 正在写的区域
- 是否需要把 D2 本地缓冲和 D1 大缓冲分层
- 是否应该用 MDMA 做二级搬运

这个顺序能帮你避开 80% 以上的无效调试。

---

# 结语

STM32H723 的 DMA 与 RAM 问题，本质上不是一个“外设配置小失误”，而是一道架构题。

你只要把这几个角色分清：

- **DTCM**：很快，但偏 CPU 私有
- **AXI SRAM / SRAM1 / SRAM2 / SRAM4**：共享给系统，但要考虑域和 Cache
- **DMA1 / DMA2 / BDMA / MDMA**：各自活在不同的访问路径上
- **D-Cache**：能提速，也能让你读到一份“看起来像真的旧数据”

整件事就会从“玄学”变成“可验证、可修复、可复用的工程问题”。

以后再看到“DMA 没搬动”，别急着重生成工程、删 `.ioc`、或者给 HAL 烧香。  
先问三句话：

1. **这块 RAM，DMA 到得了吗？**
2. **这块 RAM，CPU 和 DMA 看的是同一份数据吗？**
3. **如果前两条都满足，是不是才轮到总线竞争？**

把这三句问完，问题通常就已经被你抓住七寸了。

---

# 参考资料

1. [DS13313 - STM32H723xE/G datasheet](https://www.st.com/resource/en/datasheet/stm32h723zg.pdf)
2. [AN4891 - STM32H72x, STM32H73x, and single-core STM32H74x/75x system architecture and performance](https://www.st.com/resource/en/application_note/an4891-stm32h72x-stm32h73x-and-singlecore-stm32h74x75x-system-architecture-and-performance-stmicroelectronics.pdf)
3. [AN4839 - Level 1 cache on STM32F7 Series and STM32H7 Series](https://www.st.com/resource/en/application_note/an4839-level-1-cache-on-stm32f7-series-and-stm32h7-series-stmicroelectronics.pdf)
4. [ST DMA FAQ - DMA is not working on STM32H7 devices](https://community.st.com/t5/stm32-mcus/dma-is-not-working-on-stm32h7-devices/ta-p/49498)
5. [CMSIS D-Cache functions for Cortex-M7](https://arm-software.github.io/CMSIS_6/latest/Core/group__Dcache__functions__m7.html)

[DS13313]: https://www.st.com/resource/en/datasheet/stm32h723zg.pdf
[AN4891]: https://www.st.com/resource/en/application_note/an4891-stm32h72x-stm32h73x-and-singlecore-stm32h74x75x-system-architecture-and-performance-stmicroelectronics.pdf
[AN4839]: https://www.st.com/resource/en/application_note/an4839-level-1-cache-on-stm32f7-series-and-stm32h7-series-stmicroelectronics.pdf
[ST-DMA-FAQ]: https://community.st.com/t5/stm32-mcus/dma-is-not-working-on-stm32h7-devices/ta-p/49498
[CMSIS-DCache]: https://arm-software.github.io/CMSIS_6/latest/Core/group__Dcache__functions__m7.html
