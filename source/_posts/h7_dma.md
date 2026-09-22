---
title: H723 上 DMA 读不到数据？查 D-Cache 和内存域
mathjax: true
tags:
    - STM32
    - 嵌入式
categories: 嵌入式系统
cover: https://img.cdn1.vip/i/69c8c42418811_1774765092.webp
---

# H723 上 DMA 读不到数据？查 D-Cache 和内存域

在 STM32H723 上写 DMA,几乎每个人都会撞上同一堵墙:`HAL_UART_Receive_DMA()` 明明正常返回,缓冲区里的数据却纹丝不动;ADC 采回来的值一会儿全 0,一会儿又"好了";更诡异的是,把数组改成全局变量、加个 `static`、甚至换个大小,症状居然跟着变。

这几种现象凑在一起,基本能排除"外设时序配错了"这条路,矛头指向同一个方向:**H7 的内存架构**。

Cortex-M7 带 32KB I-Cache 和 32KB D-Cache,内部又按 D1/D2/D3 分成三个域,SRAM 散落在不同总线上,还留了 DTCM/ITCM 这种 CPU 私有的快速内存。所以" DMA 不工作"背后,通常就三类问题:

1. Buffer 放进了 DMA 根本够不着的内存区(最常见是 DTCM)
2. Buffer 位置没错,但 D-Cache 让 CPU 和 DMA 看到的是两份数据
3. 多个主设备真在抢总线带宽

下面按排查顺序展开,而不是按理论顺序。

## 先记住三句话

- DTCM 很快,但普通 DMA1/DMA2/BDMA 看不见它
- AXI SRAM / SRAM1 / SRAM2 / SRAM4 能给 DMA 用,但开了 D-Cache 必须处理一致性
- BDMA 只活在 D3 域,别把它往别的域塞

## H723 的 RAM 到底有哪些

内部 RAM 不是一整坨,而是分散在不同总线和域上。H723 大致长这样:

| 区域 | 典型基地址 | 规模 | 典型用途 | 做普通 DMA Buffer |
| --- | --- | --- | --- | --- |
| DTCM RAM | `0x20000000` | 128 KB | 栈、热点数据、ISR 高频数据 | 不适合,DMA1/DMA2/BDMA 看不到 |
| AXI SRAM | `0x24000000` | 128~320 KB | 大块缓冲、高带宽数据 | 适合,但要管 D-Cache |
| SRAM1 | `0x30000000` | 16 KB | D2 外设本地缓冲 | 适合,但要管 D-Cache |
| SRAM2 | `0x30004000` | 16 KB | D2 外设本地缓冲 | 适合,但要管 D-Cache |
| SRAM4 | `0x38000000` | 16 KB | D3/BDMA 相关缓冲 | 适合,尤其 D3/BDMA 场景 |

ITCM 我没列进来——它不是拿来干这个的。

## 坑一:Buffer 掉进了 DTCM

这是最常见、也最气人的一个错。

H72x/H73x 架构里,接在 ITCM/DTCM 接口上的内存,**只有 CPU 和 MDMA 能访问**。对普通 DMA1/DMA2 来说,DTCM 不是"访问慢",而是**根本不在它的可达路径上**。

所以把 DMA Buffer 放进 DTCM 的典型症状是:DMA 配置看着没问题、中断也来了、外设状态寄存器也像在工作,但目标数组就是不更新,或者数据莫名其妙。

ST 自己的 FAQ 专门点名过:不少示例工程会默认把内存放到 DTCM,而 D1/D2 外设的 DMA 够不着这块内存。

**判断方法简单粗暴**:先打印 Buffer 地址。如果落在 `0x20000000` 这一段,别纠结了,先挪出去再说。

## 坑二:位置对了,D-Cache 还是会坑你

很多人把数组从 `0x20000000` 挪到 `0x30000000` 之后,以为完事了,结果数据还是不对。

原因是 H723 的 Cortex-M7 带 D-Cache,而 MPU 没配置时,默认地址映射把 SRAM 当 cacheable 的 normal memory,策略是 write-back / write-allocate。这就引出两个经典场景:

### 场景 A:CPU 先写,DMA 后读

UART/SPI 发送这类场景:

1. CPU 把数据写进 SRAM
2. 数据还停在 D-Cache 里,没回写到真正的 SRAM
3. DMA 去读,读到的是旧内容
4. 发出去的数据不对

### 场景 B:DMA 先写,CPU 后读

ADC / UART RX 这类场景:

1. DMA 把新数据写回 SRAM
2. 但 CPU 之前已经把这块地址缓存了
3. CPU 读到的还是缓存里的旧数据
4. "DMA 明明完成了,数组却没变化"

对应的口诀就一条:

> **CPU 写、DMA 读:先 Clean**  
> **DMA 写、CPU 读:先 Invalidate**

## 坑三:总线竞争(通常不是第一嫌疑)

H72x/H73x 拆成多套总线矩阵,就是为了多主设备并行访问,内部仲裁器用 round-robin 解决冲突。所以总线竞争客观存在——CPU、DMA1、DMA2、ETH、USB、SDMMC 一起怼同一片 SRAM,确实可能吞吐下降、FIFO overrun、偶发超时。

但注意:如果症状是"DMA 完全不工作"或"搬运结果全错",先别往这想。前两类(DTCM、D-Cache)才是最致命、最稳定、最常见的。总线竞争更像是把前两类修完后,高负载下才暴露的第二阶段问题。

## 各 RAM 区怎么分工

**DTCM**:给 CPU 私有热点数据(栈、高频 ISR 数据、延迟敏感的控制量),不给普通 DMA。真要和 DTCM 之间搬数据,正解是 MDMA 当桥。

**SRAM1 / SRAM2**:D2 外设的本地 DMA 缓冲(USART/SPI/I2C/ADC + DMA),而且各自有独立 AHB 通路,能减少并发争用。

**AXI SRAM**:大块缓冲(图像/音频、USB/Ethernet/SDMMC),但最容易被 Cache 坑。

**SRAM4**:D3 域。注意 **BDMA 只能访问 D3 资源**——用 BDMA 的话,缓冲区优先塞 SRAM4,别往 AXI SRAM 或 DTCM 里放。

## 实战:一套稳妥的修法

### 1. 链接脚本里单独开一个 DMA Buffer 段

```ld
.dma_buffer :
{
    . = ALIGN(32);
    *(.dma_buffer)
    . = ALIGN(32);
} >RAM_D2
```

D3/BDMA 场景改成 `>RAM_D3`,大块高带宽缓冲可以 `>RAM_D1`。

### 2. 变量显式放段,32 字节对齐

CMSIS 的 D-Cache 按地址接口要求 32 字节对齐:

```c
__attribute__((section(".dma_buffer"), aligned(32)))
static uint8_t uart_rx_buf[512];

__attribute__((section(".dma_buffer"), aligned(32)))
static uint8_t uart_tx_buf[512];
```

### 3. 封装 Cache 维护函数

`SCB_CleanDCache_by_Addr()` / `SCB_InvalidateDCache_by_Addr()` 的地址都要 32 字节对齐,自己封装一层最省心:

```c
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

### 4. 发送 / 接收怎么用

发送(CPU 写完,启动 DMA 前 Clean):

```c
memcpy(uart_tx_buf, src, tx_len);
dcache_clean_by_addr(uart_tx_buf, tx_len);
HAL_UART_Transmit_DMA(&huart1, uart_tx_buf, tx_len);
```

接收(DMA 写完,CPU 读之前 Invalidate):

```c
void HAL_UART_RxCpltCallback(UART_HandleTypeDef *huart)
{
    dcache_invalidate_by_addr(uart_rx_buf, sizeof(uart_rx_buf));
    /* 此后再解析 uart_rx_buf */
}
```

half-transfer / circular DMA 同理,对"半缓冲"或"当前有效窗口"分别 invalidate。

### 5. 频繁 DMA 时,直接上 non-cacheable 区

如果某块 Buffer 更新频繁、数据量大、又被多个回调和任务来回用,与其到处 Clean/Invalidate,不如通过 MPU 把它设成 non-cacheable 或 write-through,一劳永逸。

## 两个容易漏的细节

1. **SRAM1/SRAM2 复位后时钟默认关着**,要用得先开 `RCC_AHB2ENR` 里的使能位。全程用 Cube 自动生成工程的话不太会踩;但自己改启动流程、裸机手写初始化、提前搬 `.data/.bss` 进 D2 RAM 时,别忘了这茬。

2. **关 D-Cache 只是定位手段,不是答案**。临时关掉,好了 → 基本是 Cache 一致性问题;还不好 → 回去查地址和内存域。但永久关 D-Cache 等于把 Cortex-M7 当老 MCU 用,不划算。

## 排查顺序(照这个走,能省一半时间)

1. **先看 Buffer 地址**:`0x20000000` 怀疑 DTCM,`0x24000000` 是 AXI SRAM,`0x30000000`/`0x30004000` 是 SRAM1/2,`0x38000000` 是 SRAM4。别一上来翻 HAL 源码。
2. **确认开没开 D-Cache**:开了且 Buffer 在 AXI/SRAM1/2/4,就问一句——这次是"CPU 写后 DMA 读"还是"DMA 写后 CPU 读"?然后决定 Clean 还是 Invalidate。
3. **确认 DMA 控制器属于哪个域**:DMA1/DMA2 活在 D2,BDMA 只活在 D3,MDMA 才能碰 TCM 当跨域桥。控制器选错,挪 Buffer 也是盲修。
4. **最后才怀疑带宽竞争**:只在高吞吐、满速、并发场景偶发时,再去想 Buffer 是否堆在同一片 SRAM、CPU 是否高频扫描 DMA 正在写的区域。

---

以后再遇到"DMA 没搬动",别急着重生成工程、删 `.ioc`、给 HAL 烧香。先问三句话:

1. 这块 RAM,DMA 到得了吗?
2. CPU 和 DMA 看的是同一份数据吗?
3. 前两条都满足,才轮到总线竞争吗?

问完这三句,问题通常就抓住了七寸。

## 参考资料

- [DS13313 - STM32H723xE/G datasheet](https://www.st.com/resource/en/datasheet/stm32h723zg.pdf)
- [AN4891 - STM32H72x/73x and single-core STM32H74x/75x system architecture and performance](https://www.st.com/resource/en/application_note/an4891-stm32h72x-stm32h73x-and-singlecore-stm32h74x75x-system-architecture-and-performance-stmicroelectronics.pdf)
- [AN4839 - Level 1 cache on STM32F7 and STM32H7 Series](https://www.st.com/resource/en/application_note/an4839-level-1-cache-on-stm32f7-series-and-stm32h7-series-stmicroelectronics.pdf)
- [ST DMA FAQ - DMA is not working on STM32H7 devices](https://community.st.com/t5/stm32-mcus/dma-is-not-working-on-stm32h7-devices/ta-p/49498)
- [CMSIS D-Cache functions for Cortex-M7](https://arm-software.github.io/CMSIS_6/latest/Core/group__Dcache__functions__m7.html)
