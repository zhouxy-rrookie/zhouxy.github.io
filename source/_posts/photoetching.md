---
title: 光刻技术
mathjax: true
tags: 
    - 微电子
    - 集成电路
categories: 半导体
cover: https://img.cdn1.vip/i/695e6fb00fcf6_1767796656.webp
---

# 光刻工艺
<!-- more -->
**光刻的要求**
- 分辨率（高）
- 曝光视场（大）
- 图形对准精度（高） ——1/3最小特征尺寸
- 产率（大）
- 缺陷密度（低）
![](https://img.cdn1.vip/i/695b609302267_1767596179.webp)
## 掩模版制作
CAD设计、模拟、验证后由图形发生器产生**数字图形**
- x1掩模版制作——光刻式
- x4或x5投影光刻版——投影式光刻
**```x4或x5投影光刻版在制版时容易检查缺陷```**
**```版上缺陷可以修补```**
**```蒙膜保护防止颗粒玷污```**

![](https://img.cdn1.vip/i/695b668bcdc8e_1767597707.webp)

![](https://img.cdn1.vip/i/695b69462b511_1767598406.webp)

1. 通过电子束在光刻胶层写入目标电路图案
2. 对涂覆的光刻胶进行显影，得到与目标图案对应的光刻胶掩模
3. 以光刻胶为掩膜，刻蚀下方的铬层，江图案转移至铬层
4. 剥离剩余的光刻胶，露出铬层上的图案
5. 检测图案的关键尺寸，确保尺寸精度符合要求
6. 验证图案的位置精度，保证各特征的相对位置精确
7. 清洁掩模版表面的残留杂质
8. 检测掩模版上的缺陷（如针孔、多余铬点）
9. 对检测处的缺陷进行修复，保留图案的完整性
10. 在加装防尘膜前，再次清洁掩模版表面
11. 安装防尘膜，避免后续使用中颗粒物污染掩模图案
12. 完成所有工序得到掩模版

## 三种硅片曝光模式及系统

![](https://img.cdn1.vip/i/695b6e924eb2c_1767599762.webp)

### 接触式光刻机

![](https://img.cdn1.vip/i/695b6ec9cad68_1767599817.webp)

**MERCURY LAMP汞灯**：提供光刻所需的紫外光源，是图案转移的能量来源
**MIRROR反射镜+CONDENSER LENS聚光透镜**：对汞灯发出的光进行反射、汇聚，使光线均匀、稳定的照射至掩模版区域。
**TURNING MIRROR转向镜**
**EMULSION MASK乳胶掩模版**：承载目标电路图案的模板
**涂胶晶圆**：表面涂覆光刻胶的半导体晶圆，是图案转移的最终目标载体。

### 接近式光刻机

![](https://img.cdn1.vip/i/695b70aedd8f7_1767600302.webp)

**MERCURY LAMP汞灯**
**ELLIPSOIDAL MIRROR椭球镜**:汇聚汞灯光线，提升光强集中度
**TURNING MIRROR转向镜**
**COLLIMATOR准直器**：将发散光转换为平行光
**FLY'S EYE LENS复眼透镜**:优化光线均匀性，使照射到掩模版的光场更稳定
**SECOND MIRROR第二反射镜**
**CONDENSER LENS聚光透镜**
**MASK掩模版**
**RESIST-COATED WAFER涂胶晶圆**

**接触式和接近式曝光系统：**
![](https://img.cdn1.vip/i/695b78f93ac65_1767602425.webp)
![](https://img.cdn1.vip/i/695b797627e3a_1767602550.webp)
利用Fresnel衍射理论计算的间隔范围：

$$\lambda<g<\frac{W^2}{\lambda}$$

最小分辨尺寸：

$$W_{min} = \sqrt{\lambda g}$$

### 扫描投影式光刻机

![](https://img.cdn1.vip/i/695b7265aaeb2_1767600741.webp)
**MERCURY LAMP汞灯**
**PRIMARY MIRROR (CONCAVE)主反射镜（凹面）**：汇聚照明系统的光线，优化光场的集中度与传播方向
**ILLUMINATION照明系统**
**PHOTOMASK掩模版**
**SECONDARY MIRROR (CONVEX)次反射镜（凸面）**：辅助调整光路走向，配合主反射镜实现光线的精准导向
**TRAPEZOIDAL梯形组件**：参与投影光学系统的光路整形，保障图案投影的清晰度与均匀性
**WAFER晶圆**


### 步进投影式光刻机
![](https://img.cdn1.vip/i/695b75c96e50b_1767601609.webp)

**LIGHT SOURCE光源**
**COLLIMATIING LENS SYSTEM准直透镜**：将光源的发散光转换为平行光，保障光线的方向性与均匀性
**RETICLE投影掩模板**：承载目标电路图案的模板，与传统掩模版（mask）存在放大比例，适配投影系统的缩小需求
**COMPOUND LENS SYSTEM复合透镜**：实现图案的比例缩小投影，是保障投影精度的核心光学组件
**RESIST-COATED WAFER涂胶晶圆**：表面涂覆光刻胶的半导体基底，是电路图案转移的最终载体
**STEPPING AXES步进轴**：控制晶圆在X/Y方向精准移动，实现晶圆不同区域的逐次曝光

![](https://img.cdn1.vip/i/695b78475a8ad_1767602247.webp)   
DSW（direct step on wafer）晶圆直接步进工艺，是半导体制程中光刻工序的一种晶圆曝光方式，通过逐次精准步进操作，实现电路图案在整个晶圆表面的完整覆盖。

**First Step**:在晶圆局部区域完成首次曝光，确定初始图案区域，后续步进区域围绕该区域展开。
**Partially Complete**: 由步进轴控制晶圆精准移动，依次在相邻区域重复曝光，逐步覆盖晶圆大部分区域，剩余少量区域待处理。 
**Complete**:持续执行步进与曝光操作，直至电路图案覆盖整个晶圆表面，完成单次光刻的图案转移。 

**投影式——远场衍射：** 像平面远离孔径，在孔径和像平面之间设置镜头

![](https://img.cdn1.vip/i/695b7aa077c62_1767602848.webp)
![](https://img.cdn1.vip/i/695b7aa8e3f88_1767602856.webp)

### 分辨率
点物S1的爱里斑中心恰好与另一个点物S2的爱里斑边缘（第一衍射极小）相重合时，恰可分辨两物点。
两个艾里光斑的分辨率：

$$R = \frac{1.22\lambda f}{d} = \frac{1.22\lambda f}{n(2fsin\alpha)} = \frac{0.61\lambda}{nsin\alpha}$$

分辨率：
$$R = k_1 \frac{\lambda}{NA}$$

$NA = nsin\alpha$ ,数值孔径，表示手机衍射光的能力。
提高分辨率：
**1.使用短波长的光**

![](https://img.cdn1.vip/i/695e2aff4190b_1767779071.webp)
**2.减小 k1**
**3.增大 NA**
<div style="display: flex; gap: 10px; margin: 10px 0;">
  <img src="https://img.cdn1.vip/i/695e2fac56daf_1767780268.webp" style="width: 50%;" alt="图片1">
  <img src="https://img.cdn1.vip/i/695e300ac6147_1767780362.webp" style="width: 50%;" alt="图片2">
</div>



### 焦深 DOF

$$\lambda / 4 = \delta-\delta\cos\theta$$

$$\lambda/4 = \delta[1-(1 - \theta^2/2)] = \delta\theta^2/2$$

$$\theta = \sin \theta = \frac{d}{2f} = NA$$

$$DOF = \delta = ±k_2\frac{\lambda}{(NA)^2}$$

![](https://img.cdn1.vip/i/695e30a04967c_1767780512.webp)

### 调制传递函数MTF-对比度

![](https://img.cdn1.vip/i/695e33c8233e3_1767781320.webp)

$$MTF = \frac{I_{max} - I_{min}}{I_{max} + I_{min}}$$

![](https://img.cdn1.vip/i/695e35276e20c_1767781671.webp)

![](https://img.cdn1.vip/i/695e3471e6651_1767781489.webp)

## 光刻胶

光刻胶的作用：对于入射光子有化学变化，保持潜像至显影，从而实现图形转移，即空间图像->潜像。
灵敏度：单位面积的胶曝光所需的光能量
抗蚀性：刻蚀和离子注入

<div style="display: flex; gap: 10px; margin: 10px 0;">
  <img src="https://img.cdn1.vip/i/695e63d466cfb_1767793620.webp" style="width: 50%;" alt="图片1">
  <img src="https://img.cdn1.vip/i/695e639be594a_1767793563.webp" style="width: 50%;" alt="图片2">
</div>
正胶分辨率高于负胶

### g线和i线光刻胶的组成（正胶）
(a)基底：树脂，是一种低分子量的酚醛树脂，本身溶于显影液，溶解速率为15nm/s
(b)光敏材料：二氮醌（DQ）
- DQ不溶于显影液，光刻胶在显影液中的溶解速率为1-2nm/sec
- 光照后，DQ可以自我稳定，成为溶于显影液的烃基酸
光照后光刻胶在显影液中的溶解速度为100-200nm/s
(c)溶剂是醋酸乙酯、二甲苯、乙酸溶纤剂的混合物，用于调节光刻胶的粘度。

### 负胶
当VLSI电路需分辨率达到2um之前，基本上是采用负性光刻胶。负胶在显影时线条会变粗，使其分辨率不能达到很高。
但在分辨率要求不太高的情况下，负胶也有优点：
- 对衬底表面粘附性好
- 抗刻蚀能力强
- 曝光时间短，产量高
- 工艺宽容度较高
- 价格较低（约正胶的三分之一）

**负胶的组成部分：**
- 基底：合成环化橡胶树脂，对光照不敏感，但在有机溶液如甲苯和二甲苯中溶解很快。
- 光敏材料PAC：双芳化基，当光照后，产生交联的三维分子网络，使光刻胶在显影液中具有不溶性
- 溶剂：芳香族化合物

### DUV深紫外光刻胶
传统DQN胶的问题：
- 对于< i 线波长强烈吸收
- 汞灯在DUV波段输出光强不如i线和g线，因此灵敏度不够
- 量子效率提高有限
  **PAG(photo-acid generator)**
原理：入射光子于与PAG光子反应，产生酸分子，在后续的烘烤过程中，酸分子起催化剂作用，使曝光区域光刻胶改性。
总量子效率>>1，因此**DUV胶的灵敏度有很大提高**
![](https://img.cdn1.vip/i/695e6835711ee_1767794741.png)