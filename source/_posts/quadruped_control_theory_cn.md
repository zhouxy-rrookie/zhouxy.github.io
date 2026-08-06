---
title: 四足机器人控制统一技术文档（公式推导版）
mathjax: true
tags:
    - 足式机器人
    - 控制
    - MPC
categories: 足式机器人
draft: true
---

# 四足机器人控制统一技术文档（公式推导版）

> 目标：给出一套**从单腿运动学 → 全身动力学 → MPC / WBC / RL** 的统一数学体系。  
> 采用对象：**主流 12 自由度串联四足**（浮动基座 + 4 条 3 自由度腿）。  
> 说明：若你的本体是 8 自由度并联腿或五连杆腿，**只需要替换“单腿几何闭环、雅可比、单腿惯性”部分**；从浮动基座动力学、状态估计、MPC、WBC 到 RL 的整体框架不变。

---

## 0. 总体建模对象与控制链

四足机器人广义坐标选为

$$
q = \begin{bmatrix} p_B \\ \Theta_B \\ q_j \end{bmatrix}
\in \mathbb{R}^{6+n},
\qquad
n=12,
$$

其中

- $p_B\in\mathbb{R}^3$：机身质心位置；
- $\Theta_B$：机身姿态参数（欧拉角或四元数最小参数）；
- $q_j\in\mathbb{R}^{12}$：12 个关节角；
- 浮动基速度更适合写成
$$
\nu = \begin{bmatrix} v_B \\ \omega_B \\ \dot q_j \end{bmatrix}\in\mathbb{R}^{18}.
$$

一套完备控制链路写成

$$
\text{感知/估计} \to \text{步态/落足点/摆腿轨迹} \to \text{SRB-MPC} \to \text{WBC} \to \text{关节力矩控制} \to \text{执行器}.
$$

其中：

- **状态估计**输出 $\hat p_B,\hat v_B,\hat R_{WB},\hat\omega_B$；
- **MPC** 输出未来短时域内接触力 $\lambda = [f_1^T,\dots,f_4^T]^T$；
- **WBC** 将机身任务、足端任务、接触约束综合成 $\tau$；
- **低层伺服** 将 $\tau$、$q_d$、$\dot q_d$ 作用到电机。

---

## 1. 坐标系与基础符号

设：

- 世界系 $\{W\}$；
- 机体系 $\{B\}$；
- 第 $i$ 条腿髋关节系 $\{H_i\}$；
- 足端系 $\{F_i\}$。

机身姿态用旋转矩阵

$$
R_{WB}\in SO(3),
$$

表示从机体系到世界系的方向变换。叉乘矩阵定义为

$$
[a]_\times =
\begin{bmatrix}
0 & -a_3 & a_2 \\
a_3 & 0 & -a_1 \\
-a_2 & a_1 & 0
\end{bmatrix},
\qquad
a\times b = [a]_\times b.
$$

欧拉角 $\Theta = [\phi,\theta,\psi]^T$ 与机体角速度 $\omega_B$ 的映射为

$$
\dot \Theta = T(\phi,\theta)\,\omega_B,
$$

其中（ZYX 欧拉角）

$$
T(\phi,\theta)=
\begin{bmatrix}
1 & \sin\phi\tan\theta & \cos\phi\tan\theta \\
0 & \cos\phi & -\sin\phi \\
0 & \sin\phi/\cos\theta & \cos\phi/\cos\theta
\end{bmatrix}.
$$

若直接用四元数 $q_{WB}$，则姿态传播更稳健：

$$
\dot q_{WB} = \frac12\,\Omega(\omega_B) q_{WB},
$$

其中 $\Omega(\omega)$ 为标准四元数角速度矩阵。

---

## 2. 单腿运动学：正运动学、逆运动学、雅可比

以下以**串联 3 自由度腿**为例：

- $q_1$：髋外展/内收（绕 $x$ 轴）；
- $q_2$：髋俯仰；
- $q_3$：膝俯仰；
- 大腿长 $l_2$，小腿长 $l_3$。

为使公式最紧凑，先写成无髋部固定偏距的形式。若你的腿有固定侧向偏距 $d$，只需在齐次变换中增加常量平移即可。

### 2.1 齐次变换与正运动学

令

$$
{}^{H}T_F(q) = R_x(q_1)R_y(q_2)\,\mathrm{Trans}(0,0,-l_2)\,R_y(q_3)\,\mathrm{Trans}(0,0,-l_3).
$$

则足端相对髋关节的坐标为

$$
p(q)=
\begin{bmatrix}
x \\ y \\ z
\end{bmatrix}
=
\begin{bmatrix}
- l_2\sin q_2 - l_3\sin(q_2+q_3) \\
\sin q_1\,\big(l_2\cos q_2 + l_3\cos(q_2+q_3)\big) \\
-\cos q_1\,\big(l_2\cos q_2 + l_3\cos(q_2+q_3)\big)
\end{bmatrix}.
$$

记

$$
q_{23}=q_2+q_3,
\qquad
r(q)=l_2\cos q_2+l_3\cos q_{23},
$$

则更紧凑地写成

$$
x = -l_2\sin q_2 - l_3\sin q_{23},
\qquad
y = \sin q_1\,r,
\qquad
z = -\cos q_1\,r.
$$

### 2.2 逆运动学

先由 $y,z$ 求 $q_1$：

$$
\rho = \sqrt{y^2+z^2},
\qquad
q_1 = \operatorname{atan2}(y,-z).
$$

再将三维问题转成髋俯仰-膝俯仰平面二连杆问题。定义

$$
r = \sqrt{y^2+z^2},
\qquad
x_p = x,
\qquad
z_p = -r.
$$

则有

$$
D = \frac{x_p^2+z_p^2-l_2^2-l_3^2}{2l_2l_3}.
$$

膝关节两组解（肘上/肘下）为

$$
q_3 = \operatorname{atan2}(\pm\sqrt{1-D^2},D).
$$

再求髋俯仰角：

$$
q_2 = \operatorname{atan2}(-x_p,-z_p)
      - \operatorname{atan2}(l_3\sin q_3,\,l_2+l_3\cos q_3).
$$

因此解析逆解为

$$
\boxed{
\begin{aligned}
q_1 &= \operatorname{atan2}(y,-z),\\
q_3 &= \operatorname{atan2}(\pm\sqrt{1-D^2},D),\\
q_2 &= \operatorname{atan2}(-x,-\sqrt{y^2+z^2})
      - \operatorname{atan2}(l_3\sin q_3,\,l_2+l_3\cos q_3).
\end{aligned}}
$$

若存在固定侧向偏距 $d$，则将

$$
\rho = \sqrt{y^2+z^2},
\qquad
r = \sqrt{\rho^2-d^2}
$$

替代上式中的 $\sqrt{y^2+z^2}$，并将 $q_1$ 修正为

$$
q_1 = \operatorname{atan2}(y,-z) - \operatorname{atan2}(d,r).
$$

### 2.3 足端速度雅可比

定义足端线速度

$$
\dot p = J(q)\dot q,
\qquad
q=[q_1,q_2,q_3]^T.
$$

由 $p(q)$ 对 $q$ 求偏导可得

$$
J(q)=
\begin{bmatrix}
0 & -l_2\cos q_2 - l_3\cos q_{23} & -l_3\cos q_{23} \\
\cos q_1\,r & -\sin q_1\big(l_2\sin q_2+l_3\sin q_{23}\big) & -l_3\sin q_1\sin q_{23} \\
\sin q_1\,r & \cos q_1\big(l_2\sin q_2+l_3\sin q_{23}\big) & l_3\cos q_1\sin q_{23}
\end{bmatrix}.
$$

若考虑足端角速度，则 6 维雅可比为

$$
\mathcal J(q)=
\begin{bmatrix}
J_\omega(q) \\
J_v(q)
\end{bmatrix},
$$

其中 $J_\omega$ 可通过关节轴在基坐标系下的方向向量逐列堆叠得到。

### 2.4 静力映射

由虚功原理

$$
\tau^T \delta q = f^T \delta p = f^T J\,\delta q,
$$

故有

$$
\boxed{\tau = J^T f}.
$$

这是足端力控制、VMC、接触力分配与 WBC 的最基本桥梁。

---

## 3. 单腿动力学

### 3.1 拉格朗日形式

令各连杆质心位置 $p_i(q)$、角速度 $\omega_i(q,\dot q)$，则系统动能

$$
T = \sum_{i=1}^3 \left( \frac12 m_i \dot p_i^T \dot p_i + \frac12 \omega_i^T I_i \omega_i \right),
$$

势能

$$
V = \sum_{i=1}^3 m_i g^T p_i.
$$

定义拉格朗日函数

$$
L(q,\dot q)=T-V.
$$

则动力学方程为

$$
\frac{d}{dt}\left(\frac{\partial L}{\partial \dot q}\right) - \frac{\partial L}{\partial q} = \tau.
$$

整理成标准形式：

$$
\boxed{M(q)\ddot q + C(q,\dot q)\dot q + g(q)=\tau + J_c^T\lambda.}
$$

其中 $\lambda$ 为接触约束力，若该腿处于摆动相，则 $\lambda=0$。

### 3.2 质量矩阵的雅可比表达

利用

$$
\dot p_i = J_{v,i}(q)\dot q,
\qquad
\omega_i = J_{\omega,i}(q)\dot q,
$$

可得

$$
M(q)=\sum_{i=1}^3 \left(m_i J_{v,i}^T J_{v,i} + J_{\omega,i}^T R_i I_i R_i^T J_{\omega,i}\right).
$$

重力项写成

$$
g(q)=\frac{\partial V}{\partial q}.
$$

科氏/离心项可由 Christoffel 符号表示：

$$
C_{ij}(q,\dot q)=\sum_{k=1}^n c_{ijk}(q)\dot q_k,
$$

$$
c_{ijk}(q)=\frac12\left(\frac{\partial M_{ij}}{\partial q_k}+
\frac{\partial M_{ik}}{\partial q_j}-
\frac{\partial M_{jk}}{\partial q_i}\right).
$$

于是

$$
\sum_j C_{ij}\dot q_j
=\sum_{j,k} c_{ijk}\dot q_j\dot q_k.
$$

### 3.3 牛顿-欧拉递推形式

对于工程实现，常用递推牛顿-欧拉（RNEA）或组合刚体法（CRBA）：

- 逆动力学：给定 $(q,\dot q,\ddot q)$ 计算 $\tau$；
- 正动力学：给定 $(q,\dot q,\tau)$ 计算 $\ddot q$；
- 惯量矩阵：CRBA 计算 $M(q)$。

这一步是实现高带宽控制器时最常用的数值工具链。

---

## 4. 浮动基座全身动力学

四足机器人不是固定基机械臂，而是**浮动基座系统**。令广义速度

$$
\nu =
\begin{bmatrix}
 v_B \\
 \omega_B \\
 \dot q_j
\end{bmatrix},
\qquad
\dot \nu =
\begin{bmatrix}
 \dot v_B \\
 \dot \omega_B \\
 \ddot q_j
\end{bmatrix}.
$$

则全身动力学写成

$$
\boxed{M(q)\dot \nu + h(q,\nu)=S^T\tau + J_c(q)^T\lambda.}
$$

其中：

- $M(q)\in\mathbb{R}^{(6+n)\times(6+n)}$：全身惯量矩阵；
- $h(q,\nu)$：科氏、离心、重力、关节摩擦等并项；
- $S=[0_{n\times 6}\ I_n]$：执行器选择矩阵；
- $\tau\in\mathbb{R}^n$：关节力矩；
- $J_c\in\mathbb{R}^{3m\times(6+n)}$：接触雅可比；
- $\lambda\in\mathbb{R}^{3m}$：全部接触点的接触力。

若某条腿处于支撑相且足端不滑动，则速度约束为

$$
J_c(q)\nu = 0,
$$

对时间求导得加速度约束

$$
J_c(q)\dot \nu + \dot J_c(q,\nu)\nu = 0.
$$

若处于摆动相，则对应接触雅可比行块删除。

---

## 5. 状态估计

状态估计至少需要估计

$$
\hat x = \{\hat p_B,\hat v_B,\hat R_{WB},\hat \omega_B,\hat q_j,\hat{\dot q}_j\}.
$$

### 5.1 姿态传播

IMU 给出测量

$$
\omega_m = \omega_B + b_\omega + n_\omega,
\qquad
a_m = R_{BW}(\dot v_B-g) + b_a + n_a.
$$

若用四元数，姿态传播为

$$
\dot q_{WB} = \frac12\Omega(\omega_m-b_\omega) q_{WB}.
$$

### 5.2 足端里程计/EKF

一种经典状态定义为

$$
X =
\begin{bmatrix}
 p_B \\
 v_B \\
 p_{f_1}^W \\
 p_{f_2}^W \\
 p_{f_3}^W \\
 p_{f_4}^W
\end{bmatrix}.
$$

连续时间过程模型可写成

$$
\dot p_B = v_B,
$$

$$
\dot v_B = R_{WB}(a_m-b_a-n_a)+g,
$$

$$
\dot p_{f_i}^W = w_i,
$$

其中 $w_i$ 为足点随机游走。对**支撑足**令 $Q_{f_i}$ 很小，对**摆动足**令 $Q_{f_i}$ 很大。

接触腿测量关系来自“世界系足端速度为零”：

$$
0 = v_B + \omega_B \times (R_{WB}p_{f_i}^B) + R_{WB}J_i(q)\dot q_i.
$$

等价写成观测方程

$$
z_i = 0 = H_i X + \eta_i.
$$

亦可用足端位置约束

$$
p_{f_i}^W = p_B + R_{WB}p_{f_i}^B(q_i).
$$

于是 EKF 递推为

**预测：**

$$
\hat X_{k|k-1}=f(\hat X_{k-1|k-1},u_k),
$$

$$
P_{k|k-1}=A_k P_{k-1|k-1}A_k^T + Q_k.
$$

**更新：**

$$
K_k = P_{k|k-1}H_k^T(H_k P_{k|k-1}H_k^T + R_k)^{-1},
$$

$$
\hat X_{k|k}=\hat X_{k|k-1}+K_k(z_k-h(\hat X_{k|k-1})),
$$

$$
P_{k|k}=(I-K_kH_k)P_{k|k-1}.
$$

---

## 6. 步态、摆腿轨迹、落足点规划

设步态周期 $T_g$，第 $i$ 条腿接触相位函数为

$$
\sigma_i(t)\in\{0,1\},
$$

其中 $\sigma_i=1$ 表示支撑相，$\sigma_i=0$ 表示摆动相。

### 6.1 接触序列

对角小跑可以写成

$$
(\sigma_{LF},\sigma_{RH}) = 1- (\sigma_{RF},\sigma_{LH}),
$$

相差半周期。

### 6.2 摆腿三次/五次多项式

对单个方向分量 $s(t)$，若要求起终点位置速度加速度连续，常用五次多项式：

$$
s(t)=a_0+a_1 t+a_2 t^2+a_3 t^3+a_4 t^4+a_5 t^5.
$$

边界条件

$$
s(0)=s_0,\ \dot s(0)=\dot s_0,\ \ddot s(0)=\ddot s_0,
$$
$$
s(T)=s_f,\ \dot s(T)=\dot s_f,\ \ddot s(T)=\ddot s_f
$$

解得系数向量

$$
a = A^{-1}b,
$$

其中 $A$ 为由边界条件构成的 $6\times 6$ 矩阵。

竖直方向常写成抬脚峰值形式，例如中点抬高 $h_{sw}$：

$$
z_{foot}(s)=
\begin{cases}
 z_0 + 2h_{sw}s^2, & 0\le s < 1/2,\\
 z_f + 2h_{sw}(1-s)^2, & 1/2\le s \le 1,
\end{cases}
$$

其中 $s=t/T_{sw}$ 为归一化摆动相位。

### 6.3 Raibert 落足点启发式

设期望机身速度 $v_d$，实际速度 $v$，支撑时间 $T_{st}$，则一个常见足端名义落足点为

$$
p_{foot}^{ref} = p_B + \frac{T_{st}}{2}v_B + K_v(v_B-v_d) + K_\omega(\omega_B-\omega_d).
$$

若考虑偏航角速度控制，可在机体系下加入横向偏置项。

---

## 7. 单刚体模型（SRB）

MPC 最常见的模型是 **Single Rigid Body**：

- 忽略腿惯量与腿角动量；
- 将机器人简化为质量为 $m$、惯量为 $I_B$ 的刚体；
- 控制输入为各支撑足接触力 $f_i$。

### 7.1 连续动力学

机身质心运动：

$$
\dot p = v,
$$

$$
m\dot v = \sum_{i=1}^4 \sigma_i f_i + mg.
$$

机身角动量动力学：

$$
\dot R = R[\omega]_\times,
$$

$$
I_W\dot \omega + \omega\times(I_W\omega)
= \sum_{i=1}^4 \sigma_i (r_i-p)\times f_i,
$$

其中

$$
I_W = R I_B R^T.
$$

若采用小角速度线性化，忽略 $\omega\times(I_W\omega)$，则

$$
I_W\dot\omega \approx \sum_{i=1}^4 \sigma_i (r_i-p)\times f_i.
$$

### 7.2 线性化状态方程

定义状态

$$
x = \begin{bmatrix} p \\ v \\ \Theta \\ \omega \end{bmatrix},
\qquad
u = \begin{bmatrix} f_1 \\ f_2 \\ f_3 \\ f_4 \end{bmatrix}.
$$

在小滚转/小俯仰条件下，可近似写成

$$
\dot \Theta \approx \omega.
$$

则连续线性模型可写成

$$
\dot x = A_c x + B_c u + d_c,
$$

其中

$$
A_c=
\begin{bmatrix}
0&I&0&0\\
0&0&0&0\\
0&0&0&I\\
0&0&0&0
\end{bmatrix},
$$

$$
B_c=
\begin{bmatrix}
0&0&0&0\\
\frac1mI&\frac1mI&\frac1mI&\frac1mI\\
0&0&0&0\\
I_W^{-1}[r_1-p]_\times & I_W^{-1}[r_2-p]_\times & I_W^{-1}[r_3-p]_\times & I_W^{-1}[r_4-p]_\times
\end{bmatrix},
$$

$$
d_c = \begin{bmatrix}0\\g\\0\\0\end{bmatrix}.
$$

离散化后

$$
x_{k+1} = A_d x_k + B_d u_k + d_d,
$$

其中一阶 Euler 近似为

$$
A_d \approx I + A_c\Delta t,
\qquad
B_d \approx B_c\Delta t,
\qquad
d_d \approx d_c\Delta t.
$$

更精确可用矩阵指数：

$$
A_d=e^{A_c\Delta t},
\qquad
B_d=\int_0^{\Delta t} e^{A_c\tau}B_c\,d\tau.
$$

### 7.3 预测方程（condensed form）

预测时域长度为 $N$，定义

$$
X=
\begin{bmatrix}
x_1\\x_2\\\vdots\\x_N
\end{bmatrix},
\qquad
U=
\begin{bmatrix}
u_0\\\nu_1\\\vdots\\\nu_{N-1}
\end{bmatrix}.
$$

由离散模型递推可得

$$
\boxed{X=\mathcal A x_0 + \mathcal B U + \mathcal D.}
$$

其中

$$
\mathcal A=
\begin{bmatrix}
A_d\\A_d^2\\\vdots\\A_d^N
\end{bmatrix},
$$

$$
\mathcal B=
\begin{bmatrix}
B_d & 0 & \cdots & 0\\
A_dB_d & B_d & \cdots & 0\\
\vdots & \vdots & \ddots & \vdots\\
A_d^{N-1}B_d & A_d^{N-2}B_d & \cdots & B_d
\end{bmatrix}.
$$

---

## 8. MPC 形式化为二次规划

### 8.1 代价函数

令参考状态序列为 $X^{ref}$，则一个标准目标函数是

$$
\min_U \ \frac12(X-X^{ref})^TQ(X-X^{ref}) + \frac12 U^TRU + \frac12 \Delta U^T R_\Delta \Delta U.
$$

代入预测方程后变为标准 QP：

$$
\min_U \ \frac12 U^T H U + g^T U,
$$

其中

$$
H = \mathcal B^T Q \mathcal B + R + D_\Delta^T R_\Delta D_\Delta,
$$

$$
g = \mathcal B^T Q(\mathcal A x_0 + \mathcal D - X^{ref}).
$$

### 8.2 接触约束

对每个支撑足，约束法向力为

$$
0 \le f_{z,i} \le f_{z,i}^{max}.
$$

摩擦锥

$$
\sqrt{f_{x,i}^2 + f_{y,i}^2} \le \mu f_{z,i}
$$

常用金字塔近似为 4 个线性不等式：

$$
-\mu f_{z,i} \le f_{x,i} \le \mu f_{z,i},
$$

$$
-\mu f_{z,i} \le f_{y,i} \le \mu f_{z,i}.
$$

摆动腿施加

$$
f_i = 0.
$$

于是所有约束可统一写成

$$
C U \le b,
\qquad
A_{eq}U = b_{eq}.
$$

### 8.3 接触时域长度限制

若在预测时域内假设支撑足位置不变，则为了避免“一条腿在时域内经历支撑→摆动→再次支撑”的预测错误，通常要求

$$
N\Delta t \le \frac{T_g}{2}.
$$

---

## 9. 全身控制 WBC

WBC 的目标是：在满足**接触约束与动力学一致性**的前提下，同时完成多个任务。典型任务：

1. 支撑足不滑动；
2. 机身姿态跟踪；
3. 机身质心位置/速度跟踪；
4. 摆动足轨迹跟踪；
5. 关节姿态/冗余整形。

### 9.1 任务空间 PD 加速度

对第 $k$ 个任务，定义任务变量 $x_k(q)$，其雅可比为 $J_k(q)$。加速度级任务方程为

$$
\ddot x_k = J_k \dot\nu + \dot J_k \nu.
$$

期望任务加速度常取

$$
\ddot x_k^* = \ddot x_k^{ref} + K_{d,k}(\dot x_k^{ref}-\dot x_k) + K_{p,k}(x_k^{ref}-x_k).
$$

于是理想等式为

$$
J_k \dot\nu = b_k,
\qquad
b_k = \ddot x_k^* - \dot J_k\nu.
$$

### 9.2 基于伪逆/零空间的层级 WBC

对单任务最小范数解：

$$
\dot\nu^* = J^\# b,
\qquad
J^\# = J^T(JJ^T)^{-1}
$$

（行满秩情形；近奇异点时用阻尼伪逆）

$$
J^\#_\lambda = J^T(JJ^T+\lambda^2 I)^{-1}.
$$

零空间投影矩阵：

$$
N = I - J^\# J,
\qquad
JN=0.
$$

若有两层优先级：

$$
\dot\nu_1 = J_1^\# b_1,
$$

$$
\dot\nu_2 = \dot\nu_1 + (J_2N_1)^\#(b_2-J_2\dot\nu_1),
\qquad
N_1=I-J_1^\#J_1.
$$

递推到第 $k$ 层：

$$
\dot\nu_k = \dot\nu_{k-1} + (J_kN_{k-1})^\#(b_k-J_k\dot\nu_{k-1}),
$$

$$
N_k = N_{k-1} - (J_kN_{k-1})^\# J_k N_{k-1}.
$$

这是层级逆运动学/加速度级 WBC 的核心公式。

### 9.3 动力学一致的 WBC-QP

更完整的做法是直接优化变量

$$
z = (\dot\nu,\tau,\lambda,s),
$$

其中 $s$ 为任务松弛变量。求解

$$
\min_z \ \frac12\sum_k \|J_k\dot\nu - b_k - s_k\|_{W_k}^2
+ \frac12\|\tau\|_{W_\tau}^2
+ \frac12\|\lambda\|_{W_\lambda}^2
+ \frac12\|s\|_{W_s}^2,
$$

约束为

$$
M(q)\dot\nu + h(q,\nu)=S^T\tau + J_c^T\lambda,
$$

$$
J_c\dot\nu + \dot J_c\nu = 0,
$$

$$
A_f\lambda \le b_f,
$$

$$
\tau_{min}\le \tau\le \tau_{max},
\qquad
\dot\nu_{min}\le \dot\nu\le \dot\nu_{max}.
$$

若将机身任务看得比摆动腿任务更重要，则可以用：

- **lexicographic / hierarchical QP**；
- 或**大权重差分**近似优先级。

### 9.4 MPC 与 WBC 的分工

常用分工为：

- **MPC**：决定“机身如何受力”——求 $\lambda$；
- **WBC**：决定“全身如何运动”——求 $\dot\nu,\tau$；
- 再通过动力学一致性将两者耦合。

一种简洁耦合方式是把 MPC 求出的 $\lambda^{mpc}$ 作为 WBC-QP 的参考项：

$$
\min \cdots + \frac12\|\lambda-\lambda^{mpc}\|_{W_{mpc}}^2.
$$

---

## 10. 从全身动力学到关节力矩控制

若 WBC 输出期望加速度 $\dot\nu^*$ 与接触力 $\lambda^*$，则关节力矩由动力学直接给出：

$$
S^T\tau = M\dot\nu^* + h - J_c^T\lambda^*.
$$

左乘 $S$ 得

$$
\boxed{\tau = S\big(M\dot\nu^* + h - J_c^T\lambda^*\big).}
$$

实际落地时常再叠加关节级阻抗：

$$
\tau_{cmd}=\tau + K_p(q_d-q)+K_d(\dot q_d-\dot q).
$$

若执行器只能做位置控制，则通常只能退化为

$$
\tau_{motor}=K_p(q_d-q)+K_d(\dot q_d-\dot q),
$$

此时“力控制”的上限受电机内环与减速器摩擦显著限制。

---

## 11. 强化学习 RL

RL 的价值不在于替代所有模型，而在于：

1. 学习难建模的接触与恢复策略；
2. 通过大规模仿真把经验压进策略网络；
3. 作为 **residual policy** 叠加到模型控制上。

### 11.1 MDP 定义

定义观测

$$
s_t = [R_{BW}g,\ v_B^B,\ \omega_B^B,\ q_j-q_j^{nom},\ \dot q_j,\ c_{cmd},\ \varphi_{gait},\ a_{t-1},\dots].
$$

常见动作形式：

1. 目标关节位置 $a_t=q_d$；
2. 目标关节阻抗偏置 $a_t=\Delta q_d$；
3. 直接力矩 $a_t=\tau$；
4. 残差动作 $a_t=\Delta \tau$，与模型控制叠加。

残差控制最稳妥：

$$
\tau_{cmd}=\tau_{model}+\Delta\tau_\theta(s_t).
$$

### 11.2 奖励函数

一个典型奖励可以写为

$$
r_t =
+w_v\exp\!\left(-\frac{\|v-v_{cmd}\|^2}{\sigma_v^2}\right)
+w_\omega\exp\!\left(-\frac{(\omega_z-\omega_{cmd})^2}{\sigma_\omega^2}\right)
$$

$$
\qquad
-w_q\|q_j-q_j^{nom}\|^2
-w_{\dot q}\|\dot q_j\|^2
-w_\tau\|\tau\|^2
-w_{slip}\sum_i \|v_{foot,i}^{tan}\|^2
-w_{jerk}\|a_t-a_{t-1}\|^2
-w_{coll}\,\mathbf 1_{collision}.
$$

还可加入：

- 足端离地高度奖励；
- 足端着地时序奖励；
- 机身俯仰/横滚稳定奖励；
- 能耗、热损耗、冲击惩罚。

### 11.3 PPO

策略比值

$$
r_t(\theta)=\frac{\pi_\theta(a_t|s_t)}{\pi_{\theta_{old}}(a_t|s_t)}.
$$

广义优势估计（GAE）：

$$
\delta_t = r_t + \gamma V_\phi(s_{t+1}) - V_\phi(s_t),
$$

$$
\hat A_t = \sum_{l=0}^{\infty}(\gamma\lambda)^l \delta_{t+l}.
$$

PPO 目标函数：

$$
L^{clip}(\theta)=
\mathbb E_t\Big[
\min\big(r_t(\theta)\hat A_t,
\operatorname{clip}(r_t(\theta),1-\epsilon,1+\epsilon)\hat A_t\big)
\Big].
$$

总损失常写为

$$
L(\theta,\phi)= -L^{clip}(\theta)
+ c_v\,\mathbb E\big[(V_\phi(s_t)-\hat R_t)^2\big]
- c_e\,\mathbb E\big[\mathcal H(\pi_\theta(\cdot|s_t))\big].
$$

### 11.4 域随机化与 sim2real

令环境参数集合

$$
\xi = \{m, I, \mu, K_p, K_d, motor\ delay, sensor\ noise, latency, terrain, restitution, backlash\}.
$$

训练目标改写为

$$
\theta^* = \arg\max_\theta
\mathbb E_{\xi\sim p(\xi)}
\mathbb E_{\tau\sim \pi_\theta,\,P_\xi}
\left[\sum_{t=0}^{T}\gamma^t r_t\right].
$$

这就是域随机化：

$$
\xi\sim p(\xi)
$$

在每个 episode 随机采样一次，使策略对参数不确定性鲁棒。

### 11.5 Teacher-Student / Privileged Learning

教师策略使用特权状态

$$
s_t^{priv} = [s_t,\ \text{真实地形、真实接触、真实扰动}].
$$

学生策略只用真实可测量量 $s_t$。蒸馏目标：

$$
\min_\theta \ \mathbb E\|\pi_\theta(s_t)-\pi_{teacher}(s_t^{priv})\|^2.
$$

---

## 12. 一套真正可落地的“研究级”统一控制器

如果目标是“我照着就能做出一套先进而完整的机器狗控制”，推荐的统一形式是：

### 12.1 状态估计层

$$
\hat x_t = \text{EKF/Invariant EKF}(IMU, q_j, \dot q_j, contact).
$$

### 12.2 规划层

- 步态序列：$\sigma_i(t)$；
- 摆腿轨迹：$p_{foot}^{sw}(t)$；
- 机身参考：$x^{ref}(t)$；
- Raibert 落足点：$p_{foot}^{ref}$。

### 12.3 力规划层（MPC）

$$
\lambda^{mpc}_{0:N-1} = \arg\min_U \ \frac12 U^THU+g^TU,
\quad \text{s.t. } CU\le b,\ A_{eq}U=b_{eq}.
$$

取第一步：

$$
\lambda_t^{ref} = \lambda_0^{mpc}.
$$

### 12.4 全身控制层（WBC）

$$
(\dot\nu^*,\tau^*,\lambda^*) =
\arg\min \sum_k \|J_k\dot\nu-b_k\|_{W_k}^2 + \|\lambda-\lambda_t^{ref}\|_{W_{mpc}}^2 + \|\tau\|_{W_\tau}^2
$$

$$
\text{s.t. } M\dot\nu+h=S^T\tau+J_c^T\lambda,
\quad J_c\dot\nu+\dot J_c\nu=0,
\quad A_f\lambda\le b_f.
$$

### 12.5 低层控制

$$
\tau_{cmd}=\tau^*+K_p(q_d-q)+K_d(\dot q_d-\dot q).
$$

### 12.6 残差学习（可选）

$$
\tau_{final}=\tau_{cmd}+\Delta\tau_\theta(s_t).
$$

这是目前最稳健的“模型主导 + 学习补偿”的统一形式。

---

## 13. 真正决定上限的，不只是公式

从数学上，一条控制链要真的成立，还必须满足：

### 13.1 可实现性条件

1. **驱动带宽**足够：
$$
omega_c^{motor} \gg \omega_c^{controller}.
$$

2. **关节力矩冗余**足够：
$$
\tau_{max} > \max_t \|\tau_{cmd}(t)\|.
$$

3. **接触可行**：
$$
\lambda \in \mathcal K_\mu,
$$
其中 $\mathcal K_\mu$ 为摩擦锥。

4. **估计误差受控**：
$$
\|x-\hat x\| \le \varepsilon_x.
$$

5. **模型误差受控**：
$$
\|M-\hat M\|,\ \|h-\hat h\|,\ \|J_c-\hat J_c\| \text{ 足够小。}
$$

### 13.2 一条最实用的实现顺序

1. 单腿 FK/IK/J；
2. 单腿 PD 摆腿；
3. 单腿 $\tau=J^Tf$；
4. 四足站立静力分配；
5. EKF 状态估计；
6. 步态调度 + 摆腿轨迹；
7. SRB-MPC；
8. WBC；
9. 全身逆动力学；
10. RL residual / 端到端策略。

---

## 14. 一页总公式清单

### 14.1 单腿运动学

$$
p(q)=
\begin{bmatrix}
- l_2\sin q_2 - l_3\sin(q_2+q_3) \\
\sin q_1\big(l_2\cos q_2 + l_3\cos(q_2+q_3)\big) \\
-\cos q_1\big(l_2\cos q_2 + l_3\cos(q_2+q_3)\big)
\end{bmatrix}
$$

$$
\dot p = J(q)\dot q,
\qquad
\tau = J^T f.
$$

### 14.2 全身动力学

$$
M(q)\dot\nu + h(q,\nu)=S^T\tau + J_c^T\lambda
$$

$$
J_c\nu=0,
\qquad
J_c\dot\nu+\dot J_c\nu=0.
$$

### 14.3 SRB 模型

$$
\dot p=v,
\qquad
m\dot v=\sum_i \sigma_i f_i + mg,
$$

$$
I_W\dot\omega + \omega\times(I_W\omega)=\sum_i \sigma_i (r_i-p)\times f_i.
$$

### 14.4 MPC

$$
x_{k+1}=A_dx_k+B_du_k+d_d,
$$

$$
X=\mathcal A x_0 + \mathcal B U + \mathcal D,
$$

$$
\min_U \frac12 U^THU+g^TU,
\quad
\text{s.t. } CU\le b.
$$

### 14.5 WBC

$$
\ddot x_k = J_k\dot\nu + \dot J_k\nu,
$$

$$
\ddot x_k^*=\ddot x_k^{ref}+K_d(\dot x_k^{ref}-\dot x_k)+K_p(x_k^{ref}-x_k),
$$

$$
\dot\nu_k = \dot\nu_{k-1} + (J_kN_{k-1})^\#(b_k-J_k\dot\nu_{k-1}),
$$

或

$$
\min_{\dot\nu,\tau,\lambda} \sum_k \|J_k\dot\nu-b_k\|_{W_k}^2
$$

$$
\text{s.t. } M\dot\nu+h=S^T\tau+J_c^T\lambda.
$$

### 14.6 PPO

$$
L^{clip}(\theta)=
\mathbb E\left[\min\big(r_t\hat A_t,\operatorname{clip}(r_t,1-\epsilon,1+\epsilon)\hat A_t\big)\right]
$$

$$
\hat A_t = \sum_{l=0}^{\infty}(\gamma\lambda)^l \delta_{t+l},
\qquad
\delta_t=r_t+\gamma V(s_{t+1})-V(s_t).
$$

---

## 15. 最后一条建议

如果你只实现一条路线，优先做：

$$
\boxed{\text{状态估计} + \text{步态/摆腿} + \text{SRB-MPC} + \text{WBC} + \text{逆动力学}}
$$

如果你要把性能再往上推，再加：

$$
\boxed{\text{Residual RL} \quad \text{或} \quad \text{Teacher-Student RL}}
$$

这不是唯一路线，但它是最接近“理论完备、工程可落地、还能继续扩展到先进方法”的统一框架。

