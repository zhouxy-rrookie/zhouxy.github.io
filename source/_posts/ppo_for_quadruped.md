---
title: PPO 在四足机器人控制中的应用——从理论到调参实战
mathjax: true
tags:
    - 强化学习
    - PPO
    - 足式机器人
    - 控制
categories: 强化学习
cover: https://img.cdn1.vip/i/695e790568d31_1767799045.webp
---

# PPO 在四足机器人控制中的应用——从理论到调参实战

如果你已经看过前面的 [rsl_rl 源码解析](../rsl_rl_source_analysis/)，应该对 PPO 的工程实现有了清晰的了解。但那篇文章的重点是"代码怎么写"，本文则回答另一个问题：**PPO 在四足机器人 locomotion 中到底是怎么工作的、参数怎么调、坑在哪里？**

如果你跑过四足 RL 训练，大概率遇到过这些场景：
- 训练两小时，loss 曲线看着很漂亮，结果机器人原地抽搐了一下就趴了
- 换了一组 reward 权重，PPO 就不收敛了，明明之前跑得好好的
- 试着把 clip range 从 0.2 调到 0.1，方差是小了，但怎么跑也跑不快
- 明明 GAE lambda 从 0.95 改到 0.99，步态反而更差了

这些都不是 bug，是 PPO 在连续控制问题——尤其是 locomotion——中的特有现象。本文从 locomotion 的视角重新理解 PPO 的每个组件，然后给出实战调参指南。

---

## 1. 重新理解 PPO——从 locomotion 的视角

PPO 的核心公式大家都很熟悉了：

$$
L^{CLIP}(\theta) = \mathbb{E}_t \left[ \min\left( r_t(\theta) \hat{A}_t, \; \text{clip}(r_t(\theta), 1-\epsilon, 1+\epsilon) \hat{A}_t \right) \right]
$$

其中 $r_t(\theta) = \frac{\pi_\theta(a_t|s_t)}{\pi_{\theta_{old}}(a_t|s_t)}$ 是新旧策略的比率，$\epsilon$ 是 clip 范围。

但这个公式在 locomotion 语境下，有几个值得重新审视的地方。

### 1.1 为什么 clip 在四足控制中尤其重要？

对比 Atari 游戏和四足控制这两个场景：

| 维度 | Atari 游戏 | 四足 locomotion |
|------|-----------|----------------|
| 动作空间 | 离散 (4-18 个按键) | 连续 (12-20 个关节) |
| 状态维度 | 84×84 图像 | ~50-100 维 (关节位置、速度、IMU) |
| 单次动作影响 | 按键改变游戏状态 | 力矩决定机器人是否摔倒 |
| 策略更新风险 | 输掉一局游戏 | 仿真中收集到的 trajectory 数据完全不能用 |

在四足控制中，策略的一个大幅度更新可能让机器人从"能走"变成"摔倒"，而摔倒后的 trajectory 数据质量极差。用这些数据继续更新，策略会进一步恶化——**这就是 PPO 试图阻止的"策略崩溃"**。

clip 机制的核心作用是：**限制每次更新的幅度，让策略平滑演化**。这也是为什么四足 RL 几乎只用 PPO 或其变体（而不用 SAC 或 TD3）——不是因为那些算法不好，而是 PPO 的 conservative update 特性在物理控制中格外珍贵。

### 1.2 GAE——locomotion 中的信用分配

广义优势估计（GAE）在 locomotion 中的角色经常被低估：

$$
\hat{A}_t^{GAE(\gamma,\lambda)} = \sum_{l=0}^{\infty} (\gamma\lambda)^l \delta_{t+l}
$$

其中 $\delta_t = r_t + \gamma V(s_{t+1}) - V(s_t)$ 是 TD 误差。

在四足 locomotion 中，一个动作的后果往往延迟好几步才显现。比如：
- 第 100 步迈出的腿落地姿势不对
- 第 103 步身体开始倾斜
- 第 105 步机器人摔倒

GAE 的作用就是把第 100 步的"坏决策"与第 105 步的"坏结果"连接起来。$\lambda$ 控制这个连接的范围：
- $\lambda \to 0$：只看单步 TD 误差，噪声大但偏差小
- $\lambda \to 1$：看整个轨迹的累计回报，偏差大但方差小

在 locomotion 中，$\lambda$ 通常取 0.95 左右，但这并不是万能的。稍后我们在调参部分会详细讨论。

### 1.3 Actor-Critic 架构在四足控制中的特殊性

很多入门教程把 actor-critic 画成一个共享 backbone 的架构，但在四足 locomotion 的实际实现中（如 rsl_rl），**actor 和 critic 通常是分开的网络**。这不是懒惰，而是有充分理由的：

**Actor 需要的表征 vs Critic 需要的表征是不同的：**
- Actor 只关心"在当前状态下输出什么力矩"，它对 body 姿态的微小变化可能需要很敏感
- Critic 需要估计"从当前状态出发的长期价值"，更需要全局视角

更重要的是，**asymmetric actor-critic** 在四足控制中几乎是标配：
- **训练时**：critic 可以看到 privileged information（真值速度、足端接触力、地面摩擦力系数等）
- **部署时**：actor 只能看到 sensor observations（IMU、关节编码器、可能还有深度相机）

这意味着 actor 必须学会从受限的观测中推断 critic 看到的信息，这本身就是一种 implicit distillation。

---

## 2. 四足 PPO 的超参选择

当你从 Isaac Gym / Isaac Lab 或 rsl_rl 的默认配置开始训练时，一个自然的疑问是：**这些默认值是怎么来的？它们为什么 work？**

### 2.1 学习率：为什么 locomotion 用 $5\times 10^{-5}$ 而不是 $3\times 10^{-4}$

Atari 领域的 PPO 通常用 $2.5\times 10^{-4}$ 的学习率，但四足 locomotion 的常见设置是 $1\times 10^{-3}$（Adam，配合 learning rate schedule 衰减）。

这看起来矛盾——locomotion 是更复杂的任务，为什么反而用更高的学习率？

答案在于**数据效率 vs 更新频率**的权衡。在四足 RL 中：
- 每个 rollout 收集数百万步数据（以 ANYmal 为例，一次更新基于约 2-8M 时间步）
- 数据量远大于 Atari PPO 的 batch size（256-2048）
- 更大的数据集允许更高的学习率而不导致过拟合

实际上，rsl_rl 中 PPO 的默认学习率是 $1\times 10^{-3}$，配合 linear schedule 在训练过程中衰减到 0。

但如果你的任务比较特殊（比如 reward 很稀疏、或者 domain randomization 很强），考虑降到 $3\times 10^{-4}$ 起步。

### 2.2 Clip range：0.2 还是 0.1？

标准 PPO 的 clip range 是 $\epsilon = 0.2$。但在四足 locomotion 实践中：

- **$\epsilon = 0.2$**：更激进的策略更新，训练更快但可能不稳定
- **$\epsilon = 0.1$**：更保守，适合复杂地形或稀疏 reward

一个实用的判断方法：**如果训练中回报（return）的波动超过 30%，考虑降低 clip range 或者增大 mini-batch size**。

### 2.3 GAE lambda 的选择

| $\lambda$ | 效果 | 适用场景 |
|-----------|------|---------|
| 0.90-0.93 | 更关注近期奖励，降低方差 | reward 设计精细、dense reward |
| 0.95 | 标准值 | 绝大多数 locomotion 任务 |
| 0.97-0.99 | 更关注长期后果 | 稀疏 reward、需要长期规划的步态 |

一个常见的误区：**不要为了追求稳定性把 $\lambda$ 设得太低**。低 $\lambda$ 虽然降低了优势估计的方差，但在 locomotion 中会让策略变得短视——因为一个最佳步态的效果往往要在几步甚至十几步之后才能体现出来。

### 2.4 Mini-batch size 与更新次数

在 rsl_rl 中，PPO 的默认配置通常是在每个 epoch 对 collected data 做 5 次更新，每次 mini-batch size 约 8192-32768。

关键直觉：
- **更大的 mini-batch** → 更稳定的梯度估计 → 可以用更高的学习率
- **更多的更新次数** → 更好地利用 collected data → 数据效率更高

但这两个参数并不是越大越好。实践中，如果你发现：
- **训练后期 loss 振荡**：增大 mini-batch size 或减少 epoch
- **策略收敛太慢**：尝试把 mini-batch size 减半，增加 epoch 数
- **值函数（value）发散**：优先检查 reward scaling 是否合理，其次才调 PPO 参数

### 2.5 Entropy bonus 的作用

$$
L^{PPO} = L^{CLIP} - c_1 L^{VF} + c_2 S[\pi_\theta](s)
$$

$S[\pi_\theta](s)$ 是策略熵，$c_2$ 是熵系数。在四足控制中：

- **默认值**：$c_2 = 0.01$（rsl_rl）或 $c_2 = 0.0$（一些消融实验）
- **熵系数太高**：策略保持随机，步态抖动，关节力矩噪声大
- **熵系数太低**：策略过早确定化，可能陷入局部最优（比如只会匀速前进，不会调整步态适应地形变化）

一个实用的策略：**在训练初期（前 10% 的 iterations）设 $c_2 = 0.01-0.02$，然后线性衰减到 0**。这样可以保证早期充分探索，后期策略确定化以提高性能。

---

## 3. 实战调参指南

### 3.1 Loss 曲线到底怎么看？

在四足 RL 训练中，我通常会同时看这几条曲线来判断训练是否正常：

| 曲线 | 正常信号 | 异常信号 |
|------|---------|---------|
| Total reward / episode | 持续上升后趋于平稳 | 突然暴跌 → 策略崩溃 |
| Explained variance of V | > 0.8 且稳定 | < 0.5 → critic 学不动了 |
| Policy entropy | 缓慢下降后趋于稳定 | 某次 update 后骤降为 0 → 策略坍塌 |
| KL divergence | < 0.01 且平稳 | > 0.02 → 更新太激进 |
| Clip fraction | 10-20% 被 clip | > 30% → clip range 需要增大或 policy 更新太激进 |

### 3.2 策略崩溃后的恢复方法

策略崩溃（policy collapse）在四足 RL 中很常见，表现为 episode reward 在某次 update 后骤降并无法恢复。常见原因和解决方法：

**原因 1：优势估计方差太大**
- 现象：value loss 骤升，explained variance 骤降
- 解决：增大 GAE $\lambda$、增大 batch size、或者检查 reward 是否有 NaN

**原因 2：更新步长过大**
- 现象：clip fraction > 30%，KL > 0.02
- 解决：降低学习率、减小 clip range、或者减小 max_grad_norm

**原因 3：reward 设计冲突**
- 现象：多项目标互相矛盾（如"前进"和"节省能量"在特定条件下冲突）
- 解决：检查各 reward 项是否在同一量级，是否在某些 corner case 下互相抵消

### 3.3 从随机到行走：训练过程中的阶段

一个典型的四足 locomotion 训练会经历以下阶段：

1. **随机抽搐期**（0-5% iterations）— 策略完全是随机的，机器人原地抖动
   - 此时 alive bonus 是主要的梯度来源
   - 如果这个阶段 reward 就为零，检查 reward scaling

2. **爬行期**（5-20% iterations）— 开始学会站起来并缓慢移动
   - 速度跟踪 reward 开始生效
   - 关节限位 penalty 开始起作用，防止过度伸展

3. **稳定行走期**（20-50% iterations）— 步态模式逐渐形成
   - 大多数 reward 项已收敛到合理范围
   - 策略开始产生有节奏的 gait pattern（通常是对角步态 trot）

4. **精细调优期**（50-100% iterations）— 性能缓慢提升
   - 步态效率和鲁棒性持续提高
   - 此时 domain randomization 和地形难度可以逐渐增加

### 3.4 实际训练脚本示例

下面是一个基于 rsl_rl API 的 PPO 配置示例（重点参数已标注）：

```python
# ppo_cfg.py
from rsl_rl import PPO

class QuadrupedPPOCfg:
    class algorithm:
        # PPO 核心参数
        class_name = "PPO"
        num_learning_epochs = 5          # 每个 batch 更新 5 次
        num_mini_batches = 4             # mini-batch 数量
        clip_param = 0.2                 # 初始 clip range
        gamma = 0.99                     # 折扣因子
        lam = 0.95                       # GAE lambda
        value_loss_coef = 1.0            # value loss 权重
        entropy_coef = 0.01              # 策略熵权重
        learning_rate = 1e-3             # 初始学习率
        learning_rate_schedule = "linear" # 线性衰减到 0
        max_grad_norm = 1.0              # 梯度裁剪

    class runner:
        policy_class_name = "ActorCritic"
        num_steps_per_env = 24           # 每个环境的 rollout 步数
        max_iterations = 1500            # 总训练迭代数
        
        # 经验回放 buffer 相关
        save_interval = 50               # 保存模型间隔
        experiment_name = "quadruped"
        run_name = ""
        logger = "tensorboard"
```

实际使用时，你可能会根据具体机器人（A1、Go1、ANYmal、Mini Cheetah）微调这些参数，但上面的配置是一个很好的起点。

---

## 4. 常见问题排查

### Q1: 训练 loss 正常下降，但机器人就是不走路

这通常不是 PPO 的问题，而是 reward 设计的问题。请检查：
- 速度跟踪 reward 是否设得太低，被其他 penalty 项淹没了
- alive bonus 是否设得太高，导致"站着不动"比"往前走"的累积回报更高
- 是否缺少对"前进"的直接激励（比如前沿速度奖励）

### Q2: 策略从能走到不能走（late training collapse）

通常是 entropy 衰减到了零，策略已经确定化但陷入了局部最优。解决方法：
- 增大 entropy coefficient 或加 entropy schedule
- 增加 domain randomization，迫使策略保持鲁棒性
- 检查是否在某个特定地形/状态下策略出现了盲点

### Q3: 训练速度太慢

- 增大 `num_steps_per_env` 以减少 rollout 开销（但会增大 GPU 显存）
- 减小 `num_learning_epochs` 或 `num_mini_batches`
- 检查 `max_grad_norm` 是否设得太小（$0.1$ 通常太保守，$1.0$ 比较合理）

### Q4: Value loss 一直在增大

这是最常见的 warning 信号。可能的原因：
- **reward scale 太大**：尝试把 reward 缩放到 $[0, 1]$ 或 $[-1, 1]$ 范围
- **reward 中有 outlier**：检查是否有某些 transition 中 reward 异常高/低
- **critic 网络容量不足**：增大 critic hidden dims
- **使用 reward normalization**（rsl_rl 中默认开启）

---

## 5. 总结

PPO 在四足 locomotion 中的成功不是偶然的——它的 conservative policy update、GAE 信用分配机制、以及灵活的 actor-critic 架构与物理控制问题完美契合。但默认参数只是起点，真正要让四足机器人从会走到会跑、从平底到复杂地形，需要对 PPO 的每个组件有深入理解。

希望本文能帮你少走一些弯路。如果你在实践中遇到本文没有覆盖的问题，欢迎在评论区交流。

---

**相关文章推荐：**
- [rsl_rl 源码解析](../rsl_rl_source_analysis/) — PPO 的工程实现
- [四足机器人 Locomotion 奖励函数设计](../quadruped_reward_design/) — reward 的每个细节
- [四足机器人控制理论——从 MPC 到全身控制](../quadruped_control_theory_cn/) — PPO 之外的控制方法
