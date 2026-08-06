---
title: 从零写一个安卓蓝牙遥控 App——USB 串口、UVC 图传与自定义通信协议
mathjax: true
tags: 
    - 嵌入式
    - Android
    - 机器人
    - 蓝牙
categories: 嵌入式
---

# 从零写一个安卓蓝牙遥控 App——USB 串口、UVC 图传与自定义通信协议

前阵子为了控制一台机器人底盘，我需要一个手机遥控 App。市面上能搜到的蓝牙遥控器 App 要么功能过于简陋（就几个方向按钮），要么图传方案和自己用的不匹配。与其改别人的代码，不如自己写一个，反正需求也不算复杂：

1. 通过 USB 串口（或者蓝牙 SPP）与机器人通信
2. 通过 OTG 接入 UVC 视频采集卡显示 5.8G 模拟图传画面
3. 支持摇杆、按键和矩阵操作，能切换多种工作模式
4. 通信协议自己定，灵活扩展

这篇文章就记录一下这个 App 的完整设计与实现过程。

---

## 1. 整体架构

项目使用 Kotlin + Jetpack 全家桶，没有引入复杂的架构框架。核心模块就四个文件：

```
app/src/main/java/com/ek/blectr/
├── MainActivity.kt          # 主界面 + 控制逻辑
├── UsbSerialController.kt   # USB 串口通信封装
├── UvcPreviewController.kt  # UVC 图传预览封装
├── JoystickView.kt          # 遥杆控件（自定义 View）
├── ThrottleSteeringView.kt  # 油门/转向双轴控件
└── UpdateManager.kt         # 版本更新管理
```

从功能分层来看是这样：

```ascii
┌─────────────────────────────────────┐
│  UI 层                              │
│  (摇杆/按钮/切换开关/视频画面)       │
├─────────────────────────────────────┤
│  控制层                              │
│  (摇杆值→指令帧→发送)               │
├─────────────────────────────────────┤
│  通信层                              │
│  USB Serial → 机器人底盘             │
│  UVC Preview → 图传画面              │
└─────────────────────────────────────┘
```

控制层和 UI 层没有做严格的 MVVM 分离——这只是一个工具 App，不在手机上跑复杂状态机，保持简单即可。

---

## 2. USB 串口通信的实现

### 2.1 为什么用 USB 串口而不是经典蓝牙

问题其实不是"用哪个"，而是"能不能同时用"。

很多机器人使用 HC-05/HC-06 蓝牙模块通过串口通信，这是最常见的方式。但我的目标是：

1. 用 USB 有线连接更稳定，蓝牙 SPP 作为备选
2. 视频走单独的 5.8G 模拟图传链路
3. 控制链路单独走 USB 串口——不挤占带宽

所以最终选择了 USB 串口作为主通信链路。USB 转串口芯片兼容性好，手机上用 OTG 线 + USB 转 TTL 模块就能连。

### 2.2 基于 usb-serial-for-android

Android 的 USB 串口通信主要依赖 `com.github.mik3y:usb-serial-for-android` 这个库，它支持常见的 FTDI、CP2102、CH340、PL2303 等芯片。

`UsbSerialController` 的核心逻辑很直接：

```kotlin
class UsbSerialController(
    private val activity: AppCompatActivity,
    private val onStatus: (String) -> Unit,
) {
    private val usbManager: UsbManager =
        activity.getSystemService(Context.USB_SERVICE) as UsbManager
    private var serialPort: UsbSerialPort? = null

    fun getAvailableSerialDevices(): List<UsbDevice> {
        val allDrivers = UsbSerialProber.getDefaultProber().findAllDrivers(usbManager)
        return allDrivers
            .map { it.device }
            .filter { !isVideoDevice(it) }  // 过滤掉 UVC 设备
    }
    // ...
}
```

这里有一个细节：`getAvailableSerialDevices()` 里做了视频设备过滤。因为同一个 USB 总线上可能同时接了串口模块和 UVC 采集卡，如果不过滤，设备选择列表里会出现混淆。

连接过程其实就是三步：

```kotlin
private fun connectDevice(device: UsbDevice) {
    // 1. 打开 USB 设备
    val connection = usbManager.openDevice(device)
    // 2. 找到对应的串口驱动
    val driver = UsbSerialProber.getDefaultProber()
        .findAllDrivers(usbManager)
        .firstOrNull { it.device == device }
    val port = driver.ports.first()
    // 3. 打开串口并配置参数
    port.open(connection)
    port.setParameters(115200, 8, STOPBITS_1, PARITY_NONE)
}
```

数据发送就更简单了，直接从主线程的 ioExecutor 里调用：

```kotlin
fun write(data: ByteArray): Boolean {
    val port = serialPort ?: return false
    return try {
        port.write(data, 500)
        true
    } catch (e: IOException) {
        onStatus("USB 发送失败: ${e.message}")
        disconnect()
        false
    }
}
```

### 2.3 USB 热插拔处理

用 BroadcastReceiver 监听 `UsbManager.ACTION_USB_DEVICE_DETACHED`，当设备拔出时自动断开连接：

```kotlin
private val usbReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            ACTION_USB_PERMISSION -> { /* 权限结果处理 */ }
            UsbManager.ACTION_USB_DEVICE_DETACHED -> {
                val device = intent.getParcelableExtra<UsbDevice>(UsbManager.EXTRA_DEVICE)
                if (device != null && device == connectedDevice) {
                    disconnect()
                    onStatus("USB 设备已拔出")
                }
            }
        }
    }
}
```

如果不处理拔出事件，串口写入时会抛出 `IOException`，应用可能崩溃或无反应。

---

## 3. UVC 图传预览

### 3.1 为什么是 UVC

现在的 5.8G 模拟图传接收机很多都是 AV 输出。要给手机用，需要一路：

```
模拟图传接收机 → AV 输出 → UVC 视频采集卡 → OTG → 手机
```

UVC（USB Video Class）是 USB 视频设备的标准协议，市面上几十块钱的采集卡都支持。手机上通过 OTG 接入后，系统自动识别为摄像头设备。

### 3.2 使用 libusbCamera

图传预览用了 `org.uvccamera:lib` 这个库。核心是 `UvcPreviewController`，它封装了 UVC 设备的连接、预览启动和错误处理：

```kotlin
class UvcPreviewController(
    private val activity: AppCompatActivity,
    private val textureView: TextureView,
    private val onStatus: (String) -> Unit,
) {
    fun getAvailableCameras(): List<UsbDevice> {
        return usbManager.deviceList.values
            .filter { isUvcDevice(it) }
    }

    fun connectCamera(device: UsbDevice) {
        // UVC 设备默认是 VIDEO 类型，不需要额外驱动
        // 直接从 USB Manager 打开即可
        val connection = usbManager.openDevice(device) ?: return
        // 启动预览
        startPreview(connection)
    }
}
```

需要注意的是：

1. **UVC 权限仍然是 USB 权限**，与串口共用同一套权限机制
2. **清晰度有限**：模拟图传 5.8G 的典型分辨率是 480i（NTSC）或 576i（PAL），通过 UVC 采集后一般表现为 640×480 或 720×576，不要对画面清晰度有太高期待。对于遥控场景，看到画面轮廓和位置关系就够用了
3. **延迟**：模拟图传本身延迟极低（<10ms），但 UVC 采集 + 显示链路会增加一些。实测在 40-80ms 范围，对于大多数机器人遥控来说是能接受的

### 3.3 视频 HUD 叠加

视频画面本身是个 `TextureView`，在上面叠加了一层 HUD：

- **四角瞄准框**：帮助判断画面中心
- **中央十字线**：辅助瞄准
- **刻度尺**：左侧垂直刻度，用于判断倾斜/高度
- **准心框架**：多层嵌套方框，用于远距离瞄准参考

这些 HUD 元素全部是 XML drawable 实现的，没有用自定义 View，方便调整样式。例如四角框是四个独立的 View，各自引用不同朝向的 `<shape>` 文件。

---

## 4. 自定义通信协议

### 4.1 协议设计原则

串口通信在机器人中非常普遍，但每家协议都不一样。我设计这套协议时遵循了这么几条原则：

1. **定长帧**：每帧固定 9 字节，解析时按帧头帧尾定位，不需要读不定长数据
2. **连续发送**：控制帧每 50ms 发送一次，不是"按一下发一次"，这样即使某一帧丢失，下一帧也在路上
3. **帧头帧尾校验**：避免串口丢字节导致错位
4. **预留扩展位**：每个字节的 bit 都有明确含义，但也留了保留位

### 4.2 控制帧格式

```
[5B] [5B] [B2] [B3] [B4] [B5] [B6] [B7] [2B]
```

**Byte 0-1：帧头** `0x5B 0x5B`

**Byte 2：矩阵按键 + 模式切换**

```
高4位 [matrix:4bit] + 低4位 [mode:4bit]
```

矩阵值编码了三组不同的操作面板（称为"区"），类似一个数字键盘的物理布局；

模式值编码了当前工作模式（底盘/任务、通道1/2、三个操作区），共 12 种组合。

**Byte 3：功能按钮**

8 个 bit 对应 8 个独立开关：气泵、夹取、固定、三路灯光、切换、锁定。

**Byte 4-7：摇杆轴**

```
B4: 油门   -100~100  (无死区)
B5: 转向   -100~100  (±14 死区)
B6: 横移   -100~100  (±14 死区)
B7: 升降   -100~100  (±14 死区)
```

每个值用一个 signed byte 表示，`-100~100` 而不是 `-127~127`，因为用的是 `roundToInt().toByte()`，保留一点数值余量方便调试。

**Byte 8：帧尾** `0x2B`

### 4.3 编码示例

以"一区 + 通道1 + 底盘模式"为例，假设用户选择了"取杆 + 抬升中 + 换杆空"：

```
takePos = 0, liftPos = 1, rodPos = 0
matrixVal = 0 × 6 + 1 × 2 + 0 = 2

mode = 0 × 4 + 0 × 2 + 0 = 0

Byte2 = (2 << 4) | 0 = 0x20
```

STM32 端解析：

```c
void parse_control(tele_control_t *c, const uint8_t *b) {
    uint8_t v = b[2];
    c->matrix_key = (v >> 4) & 0x0F;
    c->mode_zone  = ((v & 0x0F) >> 2) & 0x03;
    c->mode_channel = ((v & 0x0F) >> 1) & 0x01;
    c->mode_chassis = (v & 0x0F) & 0x01;

    uint8_t f = b[3];
    c->btn_pump = (f >> 0) & 1;
    c->btn_grab = (f >> 1) & 1;
    // ...

    c->throttle = (int8_t)b[4];
    c->steering = (int8_t)b[5];
    c->strafe   = (int8_t)b[6];
    c->lift     = (int8_t)b[7];
}
```

### 4.4 为什么要用"持续发送"而不是"事件驱动"

这是很多第一次做遥控器的人容易纠结的问题。

直觉上，按一次按钮发一次数据最节省带宽。但在实际机器人遥控中：

1. **串口丢包是常态**：尤其在干扰大的环境，单次发送可能丢帧而无人知晓
2. **机器人需要"最后一次有效指令"**：如果按键抬起时不发送停止信号，机器人可能一直执行上一个动作
3. **状态同步**：底盘端需要知道遥控器"还在线"，持续发送就是天然的心跳

所以选择了 50ms 定频发送，即使所有摇杆归零也照发不误。底盘端如果在 200ms 内没收到有效帧，自动急停。

---

## 5. 自定义控件的实现

整个 App 最花时间的部分可能是那两个自定义 View：摇杆控件和油门/转向控件。

### 5.1 JoystickView（遥杆控件）

这是一个圆形遥杆，在 Canvas 上从外到内画了多层结构：

```
外圈发光 → 填充背景 → 外圈描边 → 同心环 → 十字准线 → 刻度线 → 象限标记 → 摇杆头(阴影→主体→高光) → 中心点
```

一共 11 层绘制，全部用 `Paint` 完成。颜色主题用了橙色系（`#EE781F`），配合深蓝背景（`#194779`），算是赛博朋克风。

触摸逻辑的核心只有几个公式：

```kotlin
private fun updateKnob(x: Float, y: Float) {
    val dx = x - centerX
    val dy = y - centerY
    val distance = hypot(dx, dy)
    val maxDistance = baseRadius - knobRadius
    if (distance > maxDistance && distance > 0f) {
        val scale = maxDistance / distance
        knobX = centerX + dx * scale
        knobY = centerY + dy * scale  // 夹在圆形边界内
    } else {
        knobX = x
        knobY = y
    }
}

private fun normalizedX(): Float {
    return ((knobX - centerX) / (baseRadius - knobRadius)).coerceIn(-1f, 1f)
}
```

坐标归一化到 `[-1, 1]` 区间，再在 MainActivity 里转换成 `[-100, 100]`。

### 5.2 ThrottleSteeringView（油门/转向控件）

这个控件是纵向的，只允许左右转向 + 上下油门，比遥杆少一个自由度。设计为机器人底盘控制专用：

- 左右：转向（Steering）
- 上下：油门（Throttle）

它有几点设计很有趣：

1. **Y 轴做了阻尼**：松手后会缓慢回到中位（而不是瞬间跳回），手感更平滑

```kotlin
// 在 onDraw 循环中逐渐逼近目标位置
knobCenterY += (targetKnobY - knobCenterY) * 0.22f
```

2. **死区处理在 MainActivity 层**：只有左右摇杆/转向轴才做 ±14 死区，油门轴不做。因为油门"零位漂移"比"拧一点儿没反应"更危险

3. **刻度线配合阻尼**：Y 轴上的刻度标记和阻尼配合，让操作者知道自己的推杆幅度

为什么油门/转向控件放弃死区而改用阻尼？因为在实际操作中，油门死区意味着小车在死区范围内无法微动，这在精准控制时很烦人。而阻尼 + 无死区 + 小比例映射的组合，既可以实现平滑起步，又可以在大偏移时达到全速。

### 5.3 触摸动画效果

所有可点击的按钮都加了一个"按一下就缩小再弹回"的动画效果：

```kotlin
private fun applyGamePadMotion(view: View, pressedScale: Float) {
    view.setOnTouchListener { touchedView, event ->
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                touchedView.animate()
                    .scaleX(pressedScale).scaleY(pressedScale).alpha(0.92f)
                    .setDuration(90).start()
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                touchedView.animate()
                    .scaleX(1f).scaleY(1f).alpha(1f)
                    .setDuration(110).start()
            }
        }
        false
    }
}
```

按下 90ms 缩到 0.96 倍，松手 110ms 弹回。虽然只是很小的细节，但能让界面反馈更接近游戏手柄的手感。

---

## 6. 界面布局

### 6.1 屏幕分区

布局用 ConstraintLayout + Guideline 实现，基准线使用了百分比定位：

| 区域 | 位置 | 内容 |
|------|------|------|
| 视频层 | 全屏 | UVC 相机预览 + HUD |
| 左侧边栏 | 0~20% | 功能按钮：视频连接、串口连接、配置、协议查看 |
| 右上信息区 | 20%~54% | 矩阵按键面板 / 遥测数据面板 |
| 左下半屏 | 0~55% | 油门/转向双轴控件 |
| 右下半屏 | 55%~100% | 模式选择 + 右摇杆 |
| 中缝 | — | 功能按钮列：切换/灯1/2/3 + 锁定/气泵/夹取/固定 |

这种布局的核心思想是：**大拇指够得到的地方放常用操作**。下半屏的两个区域分别对应游戏手柄左右手的感觉，右摇杆在右下角便于拇指操作，左摇杆（油门/转向）在左下角使用拇指自然位置。

右上角放信息面板，左上角放设置和连接操作。

### 6.2 响应式考虑

大屏（`layout-sw720dp`）有独立的布局文件。在平板上，边栏和按钮间距适当放大，视频区域也更大。小屏手机上则是紧凑布局。

这种"手控对应"的布局方式我改了好几轮才定下来。最初把所有按钮都集中在下半屏，结果发现手指点不到左侧的功能键——用手机遥控时通常是双手横握，拇指自然在屏幕下半区。因此把"一次连接、永久使用"类的按钮（选择设备、连接/断开、视频）移到了侧栏，最多在会话开始时操作一次。

### 6.3 侧边栏

侧边栏默认是收起的，点击侧栏按钮展开。这是一个简单的缩放动画：

```kotlin
private fun setSidebarExpanded(expanded: Boolean) {
    sidebarExpanded = expanded
    panelSidebar.visibility = if (expanded) View.VISIBLE else View.GONE
    val params = guideLeftEnd.layoutParams as ConstraintLayout.LayoutParams
    params.guidePercent = if (expanded) 0.20f else 0.03f
    guideLeftEnd.layoutParams = params
    btnSidebarToggle.text = if (expanded) "展开" else "收起"
}
```

注意这里动了 Guideline 的百分比。展开时主内容区被压缩到右侧 80%，收起来时压缩到右侧 97%（留 3% 给侧栏按钮本体）。

---

## 7. 矩阵按键面板

### 7.1 三区设计

矩阵按键面板是整个 App 最"项目定制"的部分。它服务于一个具体的机器人场景——操作杆/抓取机构，而不是通用方向控制。

面板按操作场景分为三个区：

- **一区（取杆/抬升）**：取杆(A/B) → 抬升高/中/低 → 换杆
- **二区（梅林区）**：梅林低/中/高 → 回收 → 放回 → 越区
- **三区（攻击区）**：R2高/低 + 攻击低/高 + 放块/捡块/放杆

每次切换分区时，面板会完全重建：

```kotlin
private fun rebuildKeypad() {
    keypadMatrix.removeAllViews()
    keypadButtons.clear()
    // ...
    when (switchZone) {
        0 -> { /* 一区布局 */ }
        1 -> { /* 二区布局 */ }
        2 -> { /* 三区布局 */ }
    }
}
```

用的是 `removeAllViews()` 加重新 `addView()`，而不是 `View.GONE`/`View.VISIBLE`，因为三区布局的按钮数量和排列完全不同，用 visibility 控制不如直接重建干净。

### 7.2 换杆按钮的特殊处理

一区中有一个"换杆"按钮是按下时激活、松开时恢复的（类似于扳机键），而不是普通的按一下切换状态。

```kotlin
if (switchZone == 0) {
    for (kb in btns) {
        if (kb.cellIdx == 6) {  // "换杆"按钮
            kb.btn.setOnTouchListener { _, event ->
                when (event.actionMasked) {
                    MotionEvent.ACTION_DOWN -> {
                        cellStates[6] = 1
                        cellStates[7] = 0
                    }
                    MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                        cellStates[6] = 0
                        cellStates[7] = 1  // 自动回到"换杆空"
                    }
                }
                true
            }
        }
    }
}
```

这也体现在协议编码中：一区的 `rodPos` 有两种状态，按下换杆时 = 1，松开时自动恢复为 0。底盘端也应该按"上升沿触发"来响应这个动作。

---

## 8. 配置帧和棋盘帧

除了主控制帧，协议中还定义了两种辅助帧。

### 8.1 配置帧

用于向底盘下发 12 格地图配置。每个格子的 2bit 表示四种状态（默认/R1/R2/OFF），3 个字节编码 12 个格子。

用户在 App 里点击每个格子切换状态，每个格子有默认底色：

- 默认绿色（暗绿/亮绿/黄绿 循环排布）
- 点击后变为 红(R1) → 蓝(R2) → 灰(OFF) → 默认，循环切换

视觉上通过红蓝方的区分，可以直接在屏幕上"规划"机器人的任务区域。发送时一次性打包成 9 字节帧：

```kotlin
private fun sendConfigPacket() {
    val payload = ByteArray(3)
    for (i in 0 until 12) {
        val byteIdx = i / 4
        val shift = (3 - (i % 4)) * 2
        payload[byteIdx] = (payload[byteIdx].toInt() or (cellStates[i] shl shift)).toByte()
    }
    val frame = ByteArray(9)
    frame[0] = 0x5C; frame[1] = 0x5C
    frame[2] = payload[0]; frame[3] = payload[1]; frame[4] = payload[2]
    frame[5] = 0; frame[6] = 0; frame[7] = 0
    frame[8] = 0x2C
    // 发送
}
```

帧头 0x5C 0x5C 与控制帧 0x5B 0x5B 错开，防止底盘端误识别。

### 8.2 棋盘帧

这个功能属于"锦上添花"。机器人比赛中有一种操作是"下棋"——在一个 3×3 棋盘上放置红/蓝棋子。App 端做了一个九宫格面板，点选后发送棋盘状态。

协议设计为每个格子 2bit（空白/红/蓝），压缩到 9 个格子 × 2bit = 18bit，分布在 3 个字节中。棋盘帧的帧头是 0x5D 0x5D。

```kotlin
// 格子0~7 的编码
for (i in 0 until 8) {
    val byteIdx = if (i < 4) 2 else 3
    val shift = (3 - (i % 4)) * 2
    val bits = chessStates[i].coerceIn(0, 3)
    frame[byteIdx] = (frame[byteIdx].toInt() or (bits shl shift)).toByte()
}
frame[4] = (chessStates[8].coerceIn(0, 3) and 0x03).toByte()
```

---

## 9. 版本更新与自动安装

### 9.1 OTA 更新

App 内置了一个简单的版本更新模块 `UpdateManager`。它做三件事：

1. 从远程服务器获取最新版本信息（versionCode、versionName、releaseNotes、APK 下载链接）
2. 比对本地 versionCode，如果有更新则提示用户
3. 用户确认后，下载 APK 到应用专属目录，然后调用 `Intent` 安装：

```kotlin
fun downloadAndInstall(info: UpdateInfo) {
    // 下载 APK 到 cache 目录
    // 触发系统安装 Intent
    val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(
            FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", apkFile),
            "application/vnd.android.package-archive"
        )
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION
    }
    context.startActivity(intent)
}
```

注意 Android 7.0+ 不能用 `file://` URI，必须用 FileProvider。

### 9.2 服务器端

更新信息放在一个简单的 JSON 文件中，由 Web 服务器托管。App 启动时自动检查，也可以手动触发"检查更新"按钮。

```
{
  "versionCode": 33,
  "versionName": "1.10.9",
  "releaseNotes": "...",
  "downloadUrl": "https://..."
}
```

这个设计很朴素，但在小团队项目中够用，比接入商店更新渠道省事得多。

---

## 10. 关于自定义协议的一些思考

最后聊一点协议设计上的想法。

**定长 VS 不定长**：很多人喜欢用不定长帧，加一个 length 字段，灵活度高。但在我这个场景中，9 字节够用，定长帧解析更简单——STM32 上不需要 malloc，不需要链表，一个 `if (len == 9)` 再加帧头校验就完了。

**位压缩 VS 字节对齐**：矩阵键和模式共用了一个 Byte，用高低 4bit 分开。功能按钮用了 1 个 Byte 的 8 个 bit。这种位压缩在 115200 波特率下带来的带宽节省微乎其微，但它让协议语义更紧凑：一个 Byte 就是一个独立含义域。读的时候 `(b[2] >> 4) & 0x0F` 取矩阵值，`b[2] & 0x0F` 取模式值，干净利落。

**配置帧的独立性**：配置帧用独立的帧头帧尾，这很重要。如果配置帧和控制帧混淆，底盘端可能把配置数据当成摇杆值执行，后果就是机器人突然抽搐。独立的帧头帧尾 + STM32 端的状态机解析是必要的保险。

---

## 11. 经验总结

写这个 App 花了不少精力，回头总结几条经验：

1. **自定义 View 的 Canvas 绘制性能**：摇杆控件每帧要画 11 层 Paint，在 60fps 下流畅运行没问题。但不要在 `onDraw` 里 new 对象，所有 Paint 都在初始化时创建并复用。

2. **数据发送不要在主线程**：虽然 Android 不允许在主线程做网络/串口 IO，但 Handler 定时器跑在 UI 线程。串口写操作通过 `ioExecutor.execute {}` 挪到后台线程，避免写阻塞卡 UI。

3. **串口线不要太长**：实测 50cm 以上的 USB OTG 延长线开始出现断连。如果机器人需要长距离控制，考虑加 USB 信号放大器或者直接用无线串口模块（如 ESP32 转蓝牙中转）。

4. **UVC 图传延迟的控制**：TextureView 的缓存帧数、USB 传输的 buffer 大小都会影响延迟。`UvcPreviewController` 里要设置合适的 buffer 尺寸，不要用默认值。

5. **协议文档一定要写**：有 `PROTOCOL.md` 和懒得写但事后后悔的协议的差别，就是"这是可以复用的设计"和"下个月就忘了怎么解析"的差别。每次改协议字段时，顺手更新文档。

---

## 12. 下一步可以做的事

这个 App 目前是功能完整的，但有些方向可以进一步优化：

- **双向通信**：目前只有手机→底盘的指令帧，没有底盘→手机的状态回传。加上遥测数据（电池电量、电机温度、IMU姿态）会很有价值
- **蓝牙 SPP 备选**：虽然在用 USB 串口，但加一个蓝牙 SPP 模式做备选也不难，`android.bluetooth` 标准库就支持 SPP 连接
- **自定义按键映射**：目前的矩阵按键布局是硬编码的，如果做成可配置的 XML 布局文件，可以适应更多机器人需求
- **游戏手柄支持**：Android 原生支持 HID 游戏手柄，通过 `KeyEvent` 和 `MotionEvent` 可以接入蓝牙手柄，让操控更顺手

不过就目前来说，它已经很好用了。

PROTOCOL.md 和代码都在仓库里，同一套协议也在 STM32 端跑着。如果你想做类似的遥控工具，欢迎参考。

---

*项目地址：https://github.com/ek/blectr_app （如果我有空把它开源的话）*
