---
title: 四足机器人 Locomotion 奖励函数设计——从步行到奔跑，每一分奖励的来龙去脉
mathjax: true
tags:
    - 足式机器人
    - 强化学习
    - 奖励函数
    - 控制
categories: 足式机器人
cover: https://img.cdn1.vip/i/695e790568d31_1767799045.webp
---

# 四足机器人 Locomotion 奖励函数设计——从步行到奔跑，每一分奖励的来龙去脉

如果你已经搭好了 Isaac Lab 环境、写好了 PPO 训练脚本、加载好了四足机器人的 URDF，然后满怀期待地敲下 `python scripts/train.py`，等着机器狗走出来——结果它要么原地抽搐，要么侧翻在地，要么转圈像个陀螺——恭喜你，欢迎来到奖励函数设计的世界。

强化学习社区有一句老话：**"Reward is the hypothesis of the designer."** 在四足 locomotion 这个任务上，这句话格外准确。机器狗的策略网络可以有上百万参数，但决定它最终学会什么行为的，归根结底是你写在 `compute_reward()` 函数里的那几行代码。同样的网络结构、同样的超参数、同样的仿真环境，换一套权重系数，学出来的步态可能截然不同——有的沉稳如波士顿动力的 Spot，有的则像喝醉了的柯基。

然而，关于奖励函数的内容，大多数教程要么一笔带过（"我们使用了一组精心设计的奖励项，详见论文附录"），要么只给出最终公式而不解释为什么这么设。这篇博客的目标是把奖励函数的**每个项**从动机到数学形式再到系数选择的全过程拆解清楚——不是为了给出一组"万能"系数，而是让你下次调奖励时，知道自己在调什么。

---

## 1. 奖励函数设计的基本框架

### 1.1 Sparse 与 Dense 之争

想象一下你要训练一条狗走到目标点。Sparse reward 的做法是：等它走到目标点时才给一个 +1，其他所有时刻都是 0。理论上没问题——最终反馈是对的，智能体如果试足够多次总能找到路。但在四足机器人这样的高维连续控制问题中，初始随机策略连"站着"都做不到，更别说"走到目标点"。在几十万步的探索中，绝大多数 trajectory 的奖励都是 0，梯度信号几乎为零，网络根本学不动。

因此四足 locomotion 几乎无一例外地采用 **dense reward**：每一仿真步都对当前状态给出反馈，告诉智能体"你现在走得还不错"或者"你现在歪得太厉害了"。这些 dense reward 充当了从随机初始化到稳定步态之间的**梯度阶梯**。

### 1.2 奖励项的常见分类

一篇典型的四足 locomotion 论文（如 ANYmal 的 legged_robots 系列、MIT 的 Mini Cheetah 相关工作、Robotics at Lab 的粗糙地形训练）中的奖励函数，通常包含以下几类：

| 类别 | 含义 | 典型项 |
|------|------|--------|
| 任务奖励 | 驱动机器人完成主要目标 | 前进速度跟踪、偏航角跟踪 |
| 惩罚项 | 约束不期望的行为 | 关节力矩惩罚、机身晃动惩罚 |
| 正则化项 | 维持行为平滑与稳定 | action smoothness、姿态保持 |
| 先验项 | 注入人类先验知识 | 对称步态、足端轨迹、足端高度 |

在实现上，这些项被线性组合为一个标量奖励：

$$
r_t = \sum_i w_i \cdot r_i(s_t, a_t)
$$

其中 $w_i$ 是权重系数，$r_i$ 是每个子奖励项（通常在 $[0,1]$ 或 $[-1,0]$ 范围内）。将每个子项归一化到统一量级，是后续调参的前提——否则，一个量级为 $10^3$ 的项会完全淹没量级为 $10^{-1}$ 的项。

### 1.3 关于权重的核心直觉

如果你只记住一件事，那就是：**所有权重的相对大小决定了机器狗的行为偏好**。

- 速度跟踪权重 vs. 力矩惩罚权重的比，决定了机器狗是"拼命跑"还是"省电走"
- 姿态保持权重 vs. 速度跟踪权重的比，决定了机器狗会不会为了提速而弯着腿跑
- Action rate 惩罚的权重，决定了步态是平滑的还是剧烈抖动的

每次你修改权重，本质上是在 tell the robot what matters more。这不是玄学，是可解释的设计决策。

---

## 2. 任务奖励：你想要它做什么

### 2.1 前进速度跟踪

四足 locomotion 最根本的任务是"朝指定方向移动"。最直接的奖励形式是让机器人跟踪一个基座线速度指令 $v_{\text{cmd}}$：

$$
r_{\text{vel}} = \exp\left(-\frac{\| v_{\text{cmd}} - v_B^{\text{xy}} \|^2}{\sigma_{\text{vel}}}\right)
$$

其中 $v_B^{\text{xy}}$ 是机体系下基座在水平面（$x$-$y$ 方向）的实际速度，$v_{\text{cmd}}$ 是指令速度，$\sigma_{\text{vel}}$ 控制奖励随误差衰减的速率。

这里有几个设计细节值得注意：

**为什么用指数形式而不是绝对误差？** 指数函数将误差映射到 $(0,1]$ 区间，天然归一化，且靠近目标时梯度变化柔和，远离目标时梯度趋于零——这符合"远距离时不要惩罚得太狠"的直觉。如果你用 $\|v_{\text{cmd}} - v_B\|$ 作为负奖励，那么当机器狗还不会走时，速度误差很大，负奖励也很大，网络可能学到"那我不动了"的消极策略。

**为什么只取 $x$-$y$ 平面？** 基座在 $z$ 方向的运动（弹跳、跌落）不是"前进"行为的目标，单独在另一个项里控制。混在一起会让奖励信号模糊。

**$\sigma_{\text{vel}}$ 如何选择？** 这个参数决定了"多接近才算好"。如果 $\sigma_{\text{vel}}$ 太大，奖励曲线太平，机器人到不到目标速度差别不大；如果太小，偏差一点点奖励就降为零，梯度消失。常见做法是将 $\sigma_{\text{vel}}$ 设为 $0.25 \cdot v_{\text{cmd}}$ 左右，这样当速度误差达到指令速度的 $25\%$ 时，奖励已经衰减到 $\exp(-1) \approx 0.368$。

### 2.2 偏航角速度跟踪

行走方向也包括朝向。对于四足机器人，通常用一个单独的项来控制偏航角速度 $\omega_z$：

$$
r_{\text{yaw}} = \exp\left(-\frac{|\omega_{\text{cmd},z} - \omega_{B,z}|^2}{\sigma_{\text{yaw}}}\right)
$$

注意这里的 $\omega_{\text{cmd},z}$ 可以是来自遥控器摇杆的偏航指令，也可以来自导航模块的期望转向角速度。在大多数开源实现（如 legged_gym、RSL RL）中，它是与 $v_{\text{cmd}}$ 一同传入观测空间的指令。

### 2.3 存活奖励（Alive Bonus）

一个简单但极其有效的设计：如果机器人没有摔倒（基座姿态角的俯仰和横滚在安全范围内），就给一个微小的正奖励：

$$
r_{\text{alive}} = \begin{cases}
c_{\text{alive}} & \text{if } |\phi| < \phi_{\max} \text{ and } |\theta| < \theta_{\max} \text{ and } p_z > p_{z,\min} \\
0 & \text{otherwise}
\end{cases}
$$

$c_{\text{alive}}$ 通常取 $0.5$ 到 $2.0$。这个项的作用是给探索提供一个"保底"信号：即使速度跟踪不好，只要机器狗还站着，就比摔倒了强。这在训练的早期阶段尤其重要——随机策略下机器狗每秒可能摔倒好几次，而不摔倒的 trajectory 才能积累有意义的经验。

---

## 3. 惩罚项：你不想它做什么

任务奖励告诉机器人"去做什么"，惩罚项告诉机器人"别做什么"。在很多情况下，惩罚项比任务奖励更重要——因为机器人学坏比学好快得多。

### 3.1 力矩惩罚（Energy Regularization）

可能是最重要的惩罚项，也是机器狗能否走出"正常步态"的关键。其形式通常为：

$$
r_{\text{torque}} = -\sum_{j=1}^{12} \frac{|\tau_j|^\alpha}{\alpha \cdot \tau_{\max}^{\alpha-1}}
$$

其中 $\tau_j$ 是第 $j$ 个关节的实际输出力矩，$\tau_{\max}$ 是力矩上限。

**$\alpha$ 的选取很关键**：

- $\alpha=1$（L1 惩罚）：对所有力矩一视同仁，鼓励稀疏使用关节（只动必要的关节）。
- $\alpha=2$（L2 惩罚）：大力矩受到惩罚的边际更大，倾向于分散出力、避免单关节过载。
- $1 < \alpha < 2$ 或 $\alpha=1.5$ 的折衷也很常见。

实际经验是：L1 惩罚更容易训练出自然的摆腿步态，因为它允许少量关节短时大力矩输出（比如抬腿瞬间）；L2 惩罚则更平稳，但可能导致步长变短。

一个值得参考的做法是 legged_gym 中的实现——对力矩做了归一化后再惩罚：`torque_penalty = -torque_squared.mean() * 0.00001 / (action_scale ** 2)`。这里除以动作幅度的平方是为了让惩罚量级与动作尺度解耦。

### 3.2 关节加速度与加加速度惩罚

即使力矩不大，关节运动也可能会剧烈抖动——表现为相邻时间步之间动作的剧烈变化。这种高频抖动在仿真中可能不影响行走，但迁移到实物上会带来严重的机械磨损和执行器过热。因此需要惩罚动作的变化率：

$$
r_{\text{action\_rate}} = -\sum_{j=1}^{12} (a_{t,j} - a_{t-1,j})^2
$$

其中 $a_{t,j}$ 是第 $j$ 个关节在 $t$ 时刻的动作输出（一般为目标位置或归一化力矩）。在一些实现中还会进一步惩罚动作的二阶差分，即 $(a_t - 2a_{t-1} + a_{t-2})^2$，可以理解为对动作平滑度更严格的约束。

### 3.3 关节极限惩罚

机器人关节有物理行程。当动作把关节推向极限位置时，轻则影响步态质量，重则碰撞硬限位损坏机构。通常用软约束惩罚接近极限的行为：

$$
r_{\text{joint\_limit}} = -\sum_{j=1}^{12} \left[ \mathbb{I}(q_j > q_{j,\max} - \delta) \cdot c_{\text{soft}} + \mathbb{I}(q_j > q_{j,\max}) \cdot c_{\text{hard}} \right]
$$

其中 $\delta$ 是软约束区间宽度（比如 0.1 rad），$c_{\text{soft}}$ 和 $c_{\text{hard}}$ 是不同的惩罚强度。这种做法在接近极限时给出渐进的负反馈，而不是二值化的"撞死就完"。

### 3.4 机身姿态惩罚

四足机器人行走时，躯干应该尽量保持水平。过大的俯仰或横滚角不仅影响稳定性，还可能导致 IMU 观测量漂移或 fall detection 误触发。惩罚形式：

$$
r_{\text{body\_tilt}} = -\|\Theta_B^{\text{roll,pitch}}\|^2
$$

其中 $\Theta_B^{\text{roll,pitch}}$ 是基座的横滚和俯仰角。这个项在慢速行走时可以取较大权重，保证机器人姿势端正；但在快速奔跑时（尤其是犬类步态），躯干本来就会有周期性的俯仰运动，权重需要相应降低——否则机器狗会为了保持水平而不敢加速。

### 3.5 足端滑动惩罚

腿式机器人的一个基本运动学假设是**支撑腿足端与地面无滑动**。如果训练出来的策略在支撑相有滑动，不仅效率低，在实物上还会打滑甚至摔倒。不过直接在仿真中检测滑动并不容易——我们不知道仿真的摩擦力模型在多大程度上模拟了真实接触。

一个实用的近似是：检测支撑相足端在水平方向的速度：

$$
r_{\text{slip}} = -\sum_{i \in \text{stance feet}} \|v_{i}^{\text{xy}}\|^2
$$

这里 $v_{i}^{\text{xy}}$ 是第 $i$ 条腿足端在世界系 $x$-$y$ 平面的速度。只有在足端处于接触状态时才计入惩罚，因为摆动腿的足端运动是正常的。

---

## 4. 先验项：你希望它怎么走

任务奖励和惩罚项定义了行为的"边界条件"，但还不足以决定步态的形态。先验项的任务是把人类对良好步态的直觉注入奖励函数——比如对称性、足端高度、摆动轨迹形态。

### 4.1 对称性奖励

四足机器人的对角步态（trot）具有天然对称性：左前 + 右后为一对，右前 + 左后为另一对。如果两条对角腿的相位偏差为零，则是对角步态的完美执行。可以用奖励鼓励这种对称性：

$$
r_{\text{symmetry}} = -\sum_{\text{diagonal pairs}} \|h_{\text{FL}} - h_{\text{RR}}\|^2 - \sum_{\text{diagonal pairs}} \|h_{\text{FR}} - h_{\text{RL}}\|^2
$$

其中 $h_i$ 可以是足端高度、关节角度或接触状态。这不是必需的——PPO 在大量训练后往往能自行学会对称步态——但它可以极大加速收敛，因为先验项缩小了搜索空间。

### 4.2 足端高度与摆动轨迹

足端高度决定了机器狗在摆动相中能否越过障碍物（在平坦地面则是能否避免拖地绊倒）。常用的惩罚形式：

$$
r_{\text{foot\_height}} = 
\begin{cases}
-\|p_{i,z} - h_{\text{desired}}\|^2 & \text{if foot } i \text{ is swinging and } t_{\text{swing}} > T_{\text{dead}} \\
0 & \text{otherwise}
\end{cases}
$$

其中 $h_{\text{desired}}$ 是期望的足端抬升高度（通常 0.05~0.15 m），$t_{\text{swing}}$ 是摆动相开始后的时间，$T_{\text{dead}}$ 是摆动相初期的"死区"——刚离地时足端本来就在较低位置，不应该被惩罚。

更高级的做法是跟踪一个预定义的足端椭圆轨迹。ANYmal 的早期工作就使用了参数化的足端轨迹奖励：

$$
r_{\text{foot\_traj}} = -\sum_{i=1}^{4} \|p_{i}(t) - p_{i,\text{ref}}(t)\|^2
$$

其中 $p_{i,\text{ref}}(t)$ 是依据当前步态相位插值得到的期望足端位置。这种方法可以提供更强的先验，但代价是减少了策略的自由度——如果预定义轨迹与地面几何不匹配，策略可能学出奇怪的行为来补偿。

### 4.3 足端接触模式奖励

让两条对角腿同时着地（Trot）、让三条腿同时着地（Walk）、还是让所有腿轮流抬起（Pace）——这些步态模式本质上是接触事件的时序。如果希望学出特定的步态模式，可以在接触状态上直接加奖励：

$$
r_{\text{contact}} = -\sum_{i=1}^{4} \left( c_i - c_i^{\text{target}} \right)^2
$$

其中 $c_i \in \{0,1\}$ 是足端接触状态（0 为摆动、1 为支撑），$c_i^{\text{target}}$ 是目标接触模式。不过，直接在离散变量上加奖励训练起来不太稳定，一个更平滑的替代是使用足端接触力的软阈值函数 $\sigma(f_{i,z}) = \text{sigmoid}((f_{i,z} - f_{\text{th}})/T)$ 来产生连续的接触信号。

---

## 5. 从步行到奔跑：奖励权重的演化

同样的奖励函数形式，在不同速度区间下需要不同的权重。这不是 bug，是 feature。

### 5.1 慢速行走（0.2~0.5 m/s）

在这个速度段，稳定性和姿态比速度更重要。推荐的权重偏好：

| 项 | 权重偏好 | 原因 |
|------|---------|------|
| 速度跟踪 | 中等 | 不需要太激进 |
| 力矩惩罚 | 较高 | 鼓励低能耗平稳步态 |
| 姿态惩罚 | 较高 | 保持躯干水平 |
| 足端高度 | 中等（~0.08m） | 够用就行，无需高抬腿 |
| action rate | 较高 | 强调平滑 |

这个区间的训练通常最容易收敛，也是调参的起点。

### 5.2 中速行走（0.5~1.2 m/s）

机器狗的典型 Trot 步态。此时姿态惩罚应该适当降低，因为中速 trot 本身就有周期性的俯仰运动：

| 项 | 调整 |
|------|------|
| 速度跟踪 | 提高 |
| 姿态惩罚 | 降低 30%~50% |
| 动作幅度 | 自然增大，无需额外约束 |
| 足端高度 | 略微提高（~0.10m） |

在这个区间可能第一次遇到"假收敛"现象：训练时奖励曲线很漂亮，一加扰动机器狗就倒。这是 domain randomization 不足的信号，下文会专门讨论。

### 5.3 高速奔跑（1.5 m/s+）

高速 locomotion 是另一个世界。飞行相（all feet in the air）开始出现，躯干俯仰幅度显著增大，力矩惩罚和姿态惩罚必须大幅降低，否则机器狗的 reward 函数会"告诉它不要跑太快"：

| 项 | 调整 |
|------|------|
| 速度跟踪 | 主要目标，权重提高 |
| 力矩惩罚 | 大幅降低，允许爆发输出 |
| 姿态惩罚 | 显著降低或移除 |
| 足端高度 | 提高（~0.15m），防止飞行相拖地 |
| action rate | 降低，允许快速动态调节 |

高速奔跑训练的一个典型 failure mode：机器狗学会了跳跃前进（bunny hop），而不是真正的奔跑步态。这是因为以跳跃代替跑步在短时域内也能达到相同的平均速度，但能耗更高、控制更不稳定。解决方案通常是引入与步态周期相关的奖励项。

---

## 6. 奖励设计的常见陷阱

### 6.1 奖励过度耦合

新手最常见的问题：同一个行为被多个奖励项同时鼓励或惩罚。

举例：你想让机器狗走得平稳。于是你在三个不同的地方加了姿态惩罚、加速度惩罚、动作变化惩罚。结果它们之间相互干扰——一个被姿态惩罚的尝试改成了弯腿蹲伏，但弯腿增加了关节力矩惩罚，机器人又尝试站直但这次频繁换腿导致 action rate 惩罚增大……最终策略陷入局部最优，"坐在地上不动"反而拿了最高的奖励。

**解决方法**：每次只改一个项，运行到收敛，观察行为变化。多变量同时调优时，要确保每个惩罚项有明确的可解释性。

### 6.2 奖励尺度灾难

如果速度跟踪奖励的量级是 $10^0$，力矩惩罚的量级是 $10^{-5}$，而 alive bonus 的量级是 $10^2$，那么对 PPO 的优化过程来说，alive bonus 几乎决定了梯度方向，机器狗会学到"站着不动赚存活分"。

**解决方法**：在每个 epoch 开始时记录各子奖励项的均值和方差，可视化它们的量级。如果发现某个项的量级与其他项差了两个数量级，就需要调整系数。

### 6.3 奖励与观测的同步问题

仿真中的一个隐性假设是：reward 函数可以访问 ground truth 状态量（真实速度、真实接触力）。但在实物上，很多量只能通过估计器间接获得。如果在奖励函数中使用了实物上不可测的量来驱动主要任务奖励，就会产生 Sim-to-Real gap。

例如，直接用机身速度真值 $v_B^{\text{gt}}$ 做速度跟踪奖励，策略可能会学到"依赖真值速度信号"的表示。迁移到实物上时，估计速度的噪声和延迟会直接导致策略退化。

**解决方法**：在训练奖励中使用估计器可观测的量（比如用加速度积分或观测的基座线速度），或者在 domain randomization 中对速度观测注入噪声。

---

## 7. 实战：以 Isaac Lab 为例的奖励实现

回到你之前的 [Isaac Lab 教程](/2026/03/17/isaaclab_prj/) 中搭建的 `legged_sys` 项目，一个典型的奖励函数实现大致是这样的结构：

### 7.1 奖励函数骨架

```python
@torch.jit.script
def compute_reward(
    dt: float,
    command: torch.Tensor,           # (n_envs, 3) vx, vy, omega_z
    base_vel: torch.Tensor,          # (n_envs, 3) base linear velocity
    base_ang_vel: torch.Tensor,      # (n_envs, 3) base angular velocity
    projected_gravity: torch.Tensor, # (n_envs, 3) gravity dir in base frame
    joint_pos: torch.Tensor,         # (n_envs, 12)
    joint_vel: torch.Tensor,         # (n_envs, 12)
    actions: torch.Tensor,           # (n_envs, 12) current action
    last_actions: torch.Tensor,      # (n_envs, 12) previous action
    torque: torch.Tensor,            # (n_envs, 12) joint torques
    feet_contact_forces: torch.Tensor, # (n_envs, 4)
    feet_pos: torch.Tensor,          # (n_envs, 4, 3) foot positions relative to base
    dof_pos: torch.Tensor,           # (n_envs, 12)
    dof_vel: torch.Tensor,           # (n_envs, 12)
) -> Tuple[torch.Tensor, Dict[str, torch.Tensor]]:
    """Compute the reward for each environment."""
    reward_dict = {}
    total_reward = torch.zeros(command.shape[0], device=command.device)
    
    # 1. Forward velocity tracking
    lin_vel_error = torch.sum((command[:, :2] - base_vel[:, :2]) ** 2, dim=1)
    reward_lin_vel = torch.exp(-lin_vel_error / 0.25)
    reward_dict["tracking_lin_vel"] = reward_lin_vel * 1.0
    total_reward += reward_lin_vel * 1.0
    
    # 2. Yaw rate tracking
    yaw_error = (command[:, 2] - base_ang_vel[:, 2]) ** 2
    reward_yaw = torch.exp(-yaw_error / 0.25)
    reward_dict["tracking_yaw"] = reward_yaw * 0.5
    total_reward += reward_yaw * 0.5
    
    # 3. Torque penalty
    torque_penalty = torch.sum(torque ** 2, dim=1)
    reward_dict["torque"] = -torque_penalty * 0.00002
    total_reward += reward_dict["torque"]
    
    # 4. Action rate penalty
    action_rate_penalty = torch.sum((actions - last_actions) ** 2, dim=1)
    reward_dict["action_rate"] = -action_rate_penalty * 0.01
    total_reward += reward_dict["action_rate"]
    
    # 5. Body tilt penalty
    tilt = torch.sum(projected_gravity[:, :2] ** 2, dim=1)
    reward_dict["tilt"] = -tilt * 0.05
    total_reward += reward_dict["tilt"]
    
    # 6. Joint limit penalty
    soft_limit = 0.1  # rad
    dof_pos_error = torch.clamp(
        dof_pos - dof_pos.clamp(dof_lower + soft_limit, dof_upper - soft_limit),
        min=0.0
    )
    joint_limit_penalty = torch.sum(dof_pos_error ** 2, dim=1)
    reward_dict["joint_limits"] = -joint_limit_penalty * 10.0
    total_reward += reward_dict["joint_limits"]
    
    # 7. Alive bonus
    base_height = ...  # computed from simulation
    not_fallen = (torch.abs(projected_gravity[:, 0]) < 0.8) & \
                 (torch.abs(projected_gravity[:, 1]) < 0.8)
    alive_bonus = not_fallen.float() * 0.5
    reward_dict["alive"] = alive_bonus
    total_reward += alive_bonus
    
    return total_reward, reward_dict
```

### 7.2 调参工具链建议

**不要只盯着 total reward 看。** 在训练过程中记录每一个子奖励项的时间序列，观察它们的量级和演变趋势。例如：
- `tracking_lin_vel` 的均值在 0.3~0.5 说明机器狗在朝目标方向走但不够快
- `torque` 均值持续增加说明策略越来越费力
- `alive` 突然下降说明大量环境出现了摔倒

很多训练问题从 total reward 曲线看不出端倪（total reward 可能在涨，但涨的原因是 alive bonus 增加了，实际策略在退步），而在子项曲线上暴露无遗。

### 7.3 Curriculum Learning：让奖励"进化"

一个非常有效的技巧是随着训练阶段动态调整奖励权重。初始阶段提高 alive bonus 和姿态惩罚，先让机器狗学会站着；中期加入速度跟踪，逐步降低姿态惩罚权重；后期提高速度目标并降低力矩惩罚。在代码中实现并不复杂：

```python
# 在训练循环中，根据当前进度调整权重
progress = current_step / max_steps
reward_cfg = {
    "vel_tracking": 1.0 + progress * 2.0,       # 越来越重视速度
    "torque": 0.00002 * (1.0 - progress * 0.5), # 越来越允许大力矩
    "tilt": 0.05 * max(0, 1.0 - progress * 2.0), # 早期后才重视姿态
}
```

---

## 8. Domain Randomization 对奖励函数的影响

domain randomization（DR）与奖励函数设计之间存在隐式耦合，这一点常被忽视。

### 8.1 摩擦力随机化

当摩擦力在 $[0.3, 1.5]$ 范围内随机化时，策略需要学会适应不同的地面特性。如果奖励函数中滑动惩罚的权重过高，策略在低摩擦环境下会"缩手缩脚"，迈不开步子——因为每一步都有可能打滑受罚。这时候需要在 DR 范围与滑动惩罚权重之间找到平衡。

一个实用做法是让滑动惩罚权重随 DR 参数变化：在低摩擦环境下自动降低滑动惩罚权重，在高摩擦环境下提高。

### 8.2 质量与惯量随机化

如果机器人负载质量在 $[-0.5, 1.0]$ kg 范围内随机化，对速度跟踪奖励的响应会不一致：负载轻时容易加速，负载重时加速慢。如果速度跟踪的 $\sigma_{\text{vel}}$ 太小，负载重的机器狗会持续受到速度不足的惩罚，策略可能学出"为了达到指令速度而牺牲姿态和效率"的行为。

**解决思路**：在速度跟踪奖励中引入自适应归一化：

$$
r_{\text{vel}} = \exp\left(-\frac{\|v_{\text{cmd}} - v_B\|^2}{\sigma_{\text{vel}} + \epsilon \cdot |v_{\text{cmd}}|}\right)
$$

其中 $\epsilon$ 是一个小的常系数，使得误差阈值随指令速度自适应缩放。这样快和慢的指令都有合理的惩罚尺度。

### 8.3 时延随机化

在奖励函数中使用历史动作来计算 action rate 惩罚时，需要确保时延随机化不会导致动作序列错位。例如，如果仿真控制延迟在 $[0, 20]$ ms 范围内随机，那么 `last_actions` 可能已经不再是"实际的上一帧动作"。一种处理方式是在 reward 计算时使用经过延迟补偿的动作序列。

---

## 9. 从仿真到实物的奖励一致性问题

最后一个也是最关键的问题：训练时的奖励函数在实物上并不能被直接评估。你无法在真实的机器狗身上计算 $\|v_{\text{cmd}} - v_B^{\text{gt}}\|^2$ 的 ground truth。因此，一个"设计得好"的奖励函数，不仅要能在仿真中得到高分，还要能用实物可观测的量来近似。

### 9.1 实物可观测性的分级

| 奖励项 | 仿真真值 | 实物可观测性 | 实物替代方案 |
|--------|---------|-------------|------------|
| 基座速度 | $\checkmark$ | 中等 | IMU + 里程计融合 |
| 基座姿态 | $\checkmark$ | 良好 | IMU 滤波 |
| 关节位置 | $\checkmark$ | 良好 | 编码器直接读取 |
| 关节速度 | $\checkmark$ | 中等 | 编码器差分 + 滤波 |
| 力矩 | $\checkmark$ | 取决于电机 | 电流检测 / FOC 估计 |
| 足端接触力 | $\checkmark$ | 差 | 足端力传感器或电流估计 |
| 足端位置 | $\checkmark$ | 差 | 正运动学 + 估计 |

从表格可以看出，奖励函数中过度依赖"足端位置"或"足端速度"等需要精确运动学/接触估计的量，会直接造成 Sim-to-Real gap。

### 9.2 一个实用的检查清单

在最终确定奖励函数之前，问自己几个问题：

1. **每个奖励项是否都有明确的物理动机？** 如果不能一句话说清"为什么要这个项"，删掉它。
2. **去掉任意一项，训练/retrain 后的行为会明显变差吗？** 如果不会，说明这个项不重要，可以去掉以降低调参复杂度。
3. **每个奖励项的数值量级是否与其他项在同一数量级内？** 如果不是，重新归一化。
4. **主要任务奖励是否严重依赖仿真中才有真值的量？** 如果是，考虑用可观测的近似替代。
5. **奖励函数在 domain randomization 的极端情况下是否仍然合理？** 在摩擦力最低、质量最重、延迟最大的组合下，奖励函数是否还会给出有意义的梯度信号？

---

## 10. 串联：本文与之前文章的关系

如果你一路读下来，会发现这篇博客与之前的内容有一个自然的递进关系：

**四足机器人控制理论**（从运动学到全身动力学） -> **四足 MPC 的 QP 推导**（基于物理模型的最优控制） -> **Isaac Lab 教程**（仿真环境与训练管线搭建） -> **奖励函数设计**（本文）——这是从物理模型到数据驱动的最后一块拼图。

在 MPC 的框架中，代价函数的设计思维是：你有确定的未来轨迹，你求解最优的力序列来跟踪它。在 RL 的框架中，奖励函数设计的思维是：你没有确定轨迹，你通过稀疏的信号指引机器狗自己去发现一种稳定的行为模式。

两者不是非此即彼的。实践中，你可以用 MPC 学到的步态来初始化 RL 的策略，或者用 RL 学到的奖励函数来指导 MPC 的代价函数的设计。奖励函数设计与其说是一门精确的科学，不如说是一种**意图的翻译**——把你对"良好步态"的理解，翻译成网络能理解的梯度。

> **附录**：本文中的部分数值权重基于 Unitree Go1 / A1 级别（约 12 kg，腿长约 0.3 m）的四足机器人。不同尺寸和重量的平台需要按比例缩放。一条粗略的缩放规则：关节力矩惩罚权重与 $\text{质量} \times \text{腿长}^2$ 成正比。
