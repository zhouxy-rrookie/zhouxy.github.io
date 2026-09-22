---
title: 拆解 rsl_rl 源码
mathjax: true
tags: 
    - python
    - 强化学习
categories: 强化学习
cover: https://img.cdn1.vip/i/69b969a8a421f_1773758888.webp
---

很多人第一次看 `rsl_rl`，会以为它只是“又一个 PPO 仓库”。但如果把源码真正拆开，你会发现它的核心价值并不只是实现了 PPO，而是把 **模型结构、观测组织、采样存储、训练更新、蒸馏部署** 这些环节统一进了一套非常清晰的接口里。

对于足式机器人来说，这种设计尤其重要。原因很简单：机器人强化学习不是只写一个 `policy(obs)` 就结束了。真实工程里你常常会同时面对这些问题：

- actor 和 critic 看到的观测不一样；
- 训练时可以用 privileged information，部署时却不能用；
- 有些任务只需要 MLP，有些任务要加 CNN 或 RNN；
- 训练时要高效支持并行环境、PPO、多卡同步，部署时又要能导出 JIT / ONNX。

而这组源码恰好把这些问题都落到了具体实现里。

本文会围绕你给出的几个核心文件，从 **理论公式** 和 **工程实现** 两条线同时解读 `rsl_rl`：

1. `MLP / MLPModel` 如何构成整套模型抽象；
2. `CNNModel` 和 `RNNModel` 如何复用这套接口；
3. `PPO` 的采样、GAE、裁剪目标、KL 自适应学习率如何映射到代码；
4. `Distillation` 如何把 teacher-student 蒸馏变成可部署策略；
5. 站在足式机器人训练的角度，这套库为什么“好用”。

---

# 一、通用MLP类实现

在 `rsl_rl` 里，真正的“通用”并不是只有一个 `MLP` 类，而是分成了两层：

1. **底层网络构件：`modules/mlp.py` 中的 `MLP`**  
   它只是一个纯粹的神经网络搭建器，负责按给定的 `hidden_dims` 堆叠线性层和激活函数。

2. **强化学习模型封装：`models/mlp_model.py` 中的 `MLPModel`**  
   它在 `MLP` 之上增加了强化学习需要的能力：
   - 从 `TensorDict` 中选取观测组；
   - 拼接观测并做归一化；
   - 根据配置决定输出是确定性还是随机性；
   - 构造高斯策略分布并计算 `log_prob`、`entropy`；
   - 提供 `as_jit()` 和 `as_onnx()` 便于部署导出。

这其实体现了一个很经典的工程思想：

> **把“网络结构”和“策略/价值函数语义”解耦。**

## 1.1 底层 `MLP`：一个纯粹的网络拼装器

`modules/mlp.py` 里的 `MLP` 非常干净：输入维度、隐藏层维度、输出维度、激活函数，拼成一个 `nn.Sequential` 即可。

它有两个很实用的小设计：

### （1）`hidden_dims=-1` 时自动继承输入维度

这让你在写配置时可以少写很多重复数字。比如某层只想“保持维度不变”，直接写 `-1` 即可。

### （2）输出维度可以是 tuple/list

这点很关键，因为它让 `MLP` 不只是输出一个向量，还能输出一个“结构化张量”。例如在 `MLPModel` 里，如果开启 `state_dependent_std=True`，最后一层会输出形如 `[2, action_dim]` 的张量：

- 第一份是 action mean；
- 第二份是 action std 或 log std。

这相当于把“策略均值头”和“方差头”统一塞进了一个网络里。

### （3）正交初始化接口

`init_weights()` 使用正交初始化，并允许给不同层设置不同 gain。对强化学习来说，这类初始化通常比默认初始化更稳，尤其在 actor-critic 训练初期，能让输出尺度更可控。

一个简化后的理解如下：

```python
mlp = MLP(
    input_dim=obs_dim,
    output_dim=action_dim,
    hidden_dims=[256, 256, 256],
    activation="elu",
)
```

这部分没有任何 RL 假设，它只是“神经网络积木”。

## 1.2 `MLPModel`：从网络变成“策略/价值函数模型”

真正和强化学习强相关的是 `MLPModel`。

### （1）观测不是一个 tensor，而是一个 `TensorDict`

`rsl_rl` 没有把观测写死成一个大向量，而是用 `TensorDict` 表达多组观测。比如理论上你可以有：

```python
obs = {
    "proprio": ...,
    "command": ...,
    "history": ...,
    "privileged": ...,
}
```

然后再用 `obs_groups` 指定谁看什么：

```python
obs_groups = {
    "actor": ["proprio", "command", "history"],
    "critic": ["proprio", "command", "history", "privileged"],
}
```

这正是足式机器人里非常常见的 **非对称 actor-critic（asymmetric actor-critic）**：

- actor 只能看部署时真实可获得的观测；
- critic 在训练时可以多看一些 privileged information，帮助价值函数更准确。

`MLPModel._get_obs_dim()` 会根据 `obs_set` 选中对应观测组，再把这些一维观测拼起来，得到最终输入维度。

### （2）观测归一化不是“预处理脚本”，而是模型的一部分

如果 `obs_normalization=True`，`MLPModel` 会创建一个 `EmpiricalNormalization`。

这意味着归一化参数不是离线预先算好的，而是在训练过程中在线估计：

$$
\hat{x} = \frac{x - \mu}{\sigma + \varepsilon}
$$

其中均值和方差由经验统计动态更新。这样做的好处是：

- 不同观测维度量纲差异大时更稳；
- 不需要提前扫描数据集；
- 导出模型时，归一化也会一起被导出。

对机器人任务尤其重要，因为速度、角速度、接触状态、命令量的尺度往往差别很大。

### （3）随机策略的实现非常直接：高斯分布

如果 `stochastic=True`，`MLPModel` 就不仅输出动作均值，还会构造一个高斯分布：

$$
\pi_\theta(a|s) = \mathcal{N}(\mu_\theta(s), \sigma_\theta(s))
$$

代码里支持两种标准差形式：

1. **state-independent std**：整个策略共享一个可学习参数 `std` 或 `log_std`；
2. **state-dependent std**：网络同时输出 mean 和 std/log_std。

这背后的理论直觉很简单：

- 如果动作噪声与状态关系不大，全局方差参数已经够用；
- 如果某些状态下需要更保守、某些状态下需要更激进，就可以让 std 也依赖状态。

当 `stochastic_output=True` 时，模型会从这个分布里采样动作；否则默认返回确定性的均值输出。这一点对 PPO 非常重要，因为：

- 采样阶段需要随机动作来探索；
- 更新阶段通常需要重新构造当前策略分布，计算 `log_prob` 和 `entropy`。

### （4）为什么 `MLPModel` 同时提供 `output_mean / output_std / entropy / log_prob`

因为 PPO 的目标函数并不只需要动作本身，还需要策略分布信息。

例如，PPO 的核心比率为：

$$
r_t(\theta) = \frac{\pi_\theta(a_t|s_t)}{\pi_{\theta_{old}}(a_t|s_t)}
$$

在代码里，它实际上通过 `log_prob` 来算：

$$
r_t(\theta) = \exp\big(\log \pi_\theta(a_t|s_t) - \log \pi_{\theta_{old}}(a_t|s_t)\big)
$$

所以 `MLPModel` 直接内置：

- `get_output_log_prob(outputs)`
- `output_entropy`
- `output_mean`
- `output_std`

这样上层 `PPO` 类就不需要关心具体模型结构，只要调用统一接口就行。

## 1.3 `MLPModel` 的真正价值：统一了 actor、critic、student、teacher

从接口上看，`MLPModel` 并不关心自己到底是：

- actor；
- critic；
- distillation 里的 student；
- distillation 里的 teacher。

它只关心四件事：

1. 看哪些观测；
2. 输出多少维；
3. 是否随机；
4. 是否需要导出。

于是上层算法类就可以非常干净：

- PPO 用一个 `MLPModel` 当 actor，再用一个 `MLPModel` 当 critic；
- Distillation 用一个 `MLPModel` 当 student，再用一个 `MLPModel` 当 teacher。

这就是 `rsl_rl` 很值得学的地方：**不是通过写很多“特殊类”解决问题，而是通过统一抽象减少特殊情况。**

## 1.4 实践理解：为什么足式机器人特别适合这种设计

足式机器人任务里，观测的典型组成往往是：

- 本体状态（关节角、关节速度、机身角速度）；
- 指令（期望线速度、角速度）；
- 历史状态；
- 地形/高度图；
- 仿真里才知道的 privileged information（真实摩擦系数、外力、精确接触信息等）。

如果没有 `TensorDict + obs_groups` 这种设计，你会很快陷入两个问题：

1. actor 和 critic 输入不一致时，代码会变得很乱；
2. 做 teacher-student 蒸馏时，训练态和部署态很难分清。

而 `MLPModel` 的抽象天然就把这个问题解决了。

---

# 二、从 MLP 到 CNN / RNN：统一接口的扩展

如果说 `MLPModel` 是这套库的“基类思想”，那么 `CNNModel` 和 `RNNModel` 就是在告诉你：

> **只要把 `get_latent()` 这个步骤改掉，整套 PPO / Distillation 都可以原封不动复用。**

这是一种非常优雅的扩展方式。

## 2.1 `CNNModel`：2D 观测先编码，再和 1D 特征拼接

`cnn_model.py` 继承自 `MLPModel`，但重写了两件事：

1. `_get_obs_dim()`：把观测分成 1D 和 2D 两类；
2. `get_latent()`：先用 CNN 编码 2D 观测，再和 1D 观测拼接。

也就是说，对 `CNNModel` 来说：

$$
z = [z_{1d}, z_{cnn}]
$$

其中：

- `z_{1d}` 来自普通标量观测的拼接与归一化；
- `z_{cnn}` 来自一组 CNN 编码器对 2D 输入的提取。

这很适合机器人任务里的：

- 高度图；
- 深度图；
- 栅格地图；
- 其他局部几何感知输入。

### 一个重要细节：支持多路 2D 观测

`CNNModel` 不是只支持单个图像输入。它会扫描 `obs_groups` 中所有形状为 `[B, C, H, W]` 的观测组，并为每个组建立一个 CNN encoder。

最后再把所有 CNN latent 拼起来。

这意味着你理论上可以同时输入：

- `height_map`
- `depth_image`
- `terrain_patch`

而不用手工写三套分支网络。

### 另一个很工程化的设计：支持共享 CNN 编码器

在 `ppo.py` 的 `construct_algorithm()` 里，如果配置了 `share_cnn_encoders`，critic 会直接复用 actor 的 CNN。

这有两个明显好处：

1. 节省参数量与显存；
2. 保证 actor/critic 对同一视觉输入使用一致表征。

对于图像编码开销较大的任务，这是非常实用的设计。

## 2.2 `RNNModel`：把时间记忆塞进统一接口

`rnn_model.py` 的思路也类似：继承 `MLPModel`，但是把 `get_latent()` 改成：

1. 先拼接一维观测；
2. 做归一化；
3. 送进 `RNN`（GRU 或 LSTM）；
4. 把 RNN 输出作为后续 MLP 的输入。

于是 latent 不再只是当前时刻观测，而变成了带时间记忆的表示：

$$
z_t = f_{RNN}(x_1, x_2, \dots, x_t)
$$

这对部分可观测环境非常关键。比如机器人落脚冲击、接触切换、外界扰动，单帧观测未必足够判断系统状态，历史上下文会明显有帮助。

### `RNN` 包装类的核心思想：训练模式和推理模式分开

`modules/rnn.py` 的 `RNN` 包装类做了一个很重要的区分：

- **batch mode**：更新策略时，输入是一个轨迹 batch，需要显式传入 `hidden_state` 和 `masks`；
- **inference mode**：环境交互时，一次只输入当前步观测，内部自动维护 `self.hidden_state`。

这正对应强化学习里两种完全不同的使用方式：

1. 与环境交互：一步一步滚动；
2. 策略更新：按整个 rollout / mini-batch 回放。

如果不把这两种模式分开，RNN 策略代码通常会非常混乱。

### `reset()` 与 `detach_hidden_state()` 的价值

机器人环境是并行的。假设你有 `num_envs=4096` 个环境同时跑，那么每个环境都可能在不同时间 `done`。

因此 RNN 的 hidden state 不能“整块清零”，而是要对 done 的环境局部清零：

- `reset(dones)`：把结束环境的 hidden state 置零；
- `detach_hidden_state(dones)`：对结束环境的 hidden state 做图截断，避免反向传播跨 episode 泄漏。

这两个细节非常工程化，也非常重要。

## 2.3 导出能力：为什么所有模型都实现 `as_jit()` / `as_onnx()`

在学术代码里，导出通常是“最后再补”。但 `rsl_rl` 从一开始就把导出当成模型接口的一部分。

这对机器人部署非常有意义，因为训练结束后你往往需要：

- 导出成 TorchScript 放到控制栈里；
- 或者转成 ONNX 给别的推理后端使用；
- 对 RNN 还要额外导出 hidden state 输入输出接口。

也就是说，这套代码不是只为“训练通”服务，而是考虑了“训练完之后怎么真正跑起来”。

---

# 三、基础模块补充：CNN、Normalization 与 RNN 封装

上面讲的是模型层，下面再看看更底层的几个模块。

## 3.1 `CNN`：高度可配置的卷积编码器

`modules/cnn.py` 里的 `CNN` 本质上是一个可配置的卷积堆叠器，支持：

- 每层不同的 `output_channels`；
- 每层不同的 `kernel_size / stride / dilation`；
- 可选 `batch norm` 或 `layer norm`；
- 可选 max pooling；
- 可选全局池化；
- 可选 flatten。

对工程来说，它最大的好处不是“有多先进”，而是 **足够通用**。你不需要为了不同视觉输入再写一堆特化网络，改配置就能切网络形状。

代码里还有两个实用点：

### （1）自动计算 padding 和输出尺寸

这样你在配置 CNN 时不用手算每层高宽变化，尤其当 stride、dilation、pooling 混用时，非常省心。

### （2）卷积层使用 Kaiming 初始化

这和前面 `MLP` 的正交初始化一样，属于“为稳定训练服务”的底层细节。

## 3.2 `EmpiricalNormalization`：把归一化做成在线模块

`normalization.py` 里的 `EmpiricalNormalization` 维护的是运行中的：

- 均值 `mean`
- 方差 `var`
- 标准差 `std`
- 样本数 `count`

每次 `update(x)` 时，都会在线更新统计量。这样模型前向时的归一化始终跟当前训练数据分布同步。

对强化学习而言，这比静态数据集归一化更自然，因为策略在学习，观测分布本身也在变。

### 一个容易忽略但很重要的点

这个归一化是 **在整个 batch 维度上统计**，而不是“每个环境各自统计”。这通常更稳定，也更符合并行环境训练的实现方式。

## 3.3 `EmpiricalDiscountedVariationNormalization`

这个文件里还提供了一个奖励归一化模块，它不是简单对即时奖励做标准化，而是基于折扣累计量的统计进行缩放。

理论直觉是：

$$
\bar{R}_t = \gamma \bar{R}_{t-1} + r_t
$$

然后根据这类 discounted reward 的方差估计来缩放奖励。

在大规模 PPO 研究里，这类 reward normalization 常常能帮助 value function 更快收敛。不过就你给出的这组文件来看，`PPO` 主流程里更直接使用的是观测归一化与可选 RND，而这个奖励归一化模块更像是一个可复用的工具组件。

---

# 四、PPO主流程源码解读

如果前面的模型层是在回答“策略长什么样”，那么 `ppo.py` 回答的就是：

> **一次强化学习迭代到底怎么走完。**

从接口上看，整个 PPO 类有四个关键阶段：

1. `act()`：根据当前观测输出动作；
2. `process_env_step()`：接收环境回报，把 transition 存进 rollout；
3. `compute_returns()`：根据最后一个 value 计算 returns 和 advantages；
4. `update()`：用 PPO 目标更新 actor / critic。

这四步就构成了训练主循环。

## 4.1 初始化：PPO 并不只包含 actor 和 critic

在 `__init__()` 里，PPO 除了基本的 actor/critic 和 optimizer 外，还把几个“可选扩展”也一起接进来了：

- **RND（Random Network Distillation）**：用于 intrinsic reward；
- **Symmetry**：用于数据增强或镜像损失；
- **multi_gpu_cfg**：用于多卡同步。

这说明 `rsl_rl` 的 PPO 不是“最简教材版”，而是一个面向机器人训练场景的工程版实现。

## 4.2 `act()`：采样阶段到底记录了什么

采样时，PPO 不只是输出一个动作，它还把后续更新需要的量全部记下来了：

- `actions`
- `values`
- `actions_log_prob`
- `action_mean`
- `action_sigma`
- `hidden_states`
- `observations`

这非常符合 PPO 的本质：

- actor 负责给出动作分布；
- critic 负责给出状态价值；
- 旧策略分布信息要保留下来，后续更新时用于构造概率比率。

从公式上说，后续更新要用到：

$$
\log \pi_{\theta_{old}}(a_t|s_t), \quad \mu_{old}, \quad \sigma_{old}
$$

因此这些量必须在 rollout 阶段就存下来。

## 4.3 `process_env_step()`：把环境步长变成可训练数据

这一步做了几件关键事情。

### （1）更新观测归一化器

actor、critic（以及可选的 RND）都会调用 `update_normalization(obs)`。

也就是说，归一化统计是在采样时不断更新的，而不是训练前预处理一次。

### （2）记录 rewards 和 dones

奖励被 `clone()` 后保存，原因是后面可能还要做 timeout bootstrapping。

### （3）可选加入 intrinsic rewards

如果启用了 RND，PPO 会计算 intrinsic reward，并把它加到 extrinsic reward 上：

$$
r_t^{total} = r_t^{ext} + r_t^{int}
$$

这能在稀疏奖励任务中增加探索驱动力。

### （4）处理 timeouts 的 bootstrap

这是机器人训练里一个非常实用的细节。

有些 episode 结束不是因为真正 terminal，而是因为达到时间上限。此时如果简单把它当 terminal，value target 会有偏差。所以代码里如果 `extras` 含有 `time_outs`，会把下一时刻的 value 估计补回去。

这相当于：

$$
r_t \leftarrow r_t + \gamma V(s_{t+1})
$$

用于修正时间截断带来的估计误差。

## 4.4 `compute_returns()`：GAE 是怎么落到代码里的

这部分是 PPO 理论和代码对应得最直接的地方。

代码采用的是 **Generalized Advantage Estimation (GAE)**。

先定义 TD 误差：

$$
\delta_t = r_t + \gamma V(s_{t+1}) - V(s_t)
$$

再递推优势函数：

$$
A_t = \delta_t + \gamma \lambda A_{t+1}
$$

最后 return 为：

$$
R_t = A_t + V(s_t)
$$

而代码里的逻辑几乎就是照着这个公式写的：

1. 从最后一步反向遍历；
2. 计算 `delta`；
3. 递推 `advantage`；
4. 令 `returns = advantage + values`；
5. 最后 `advantages = returns - values`。

### 为什么这里还要做 advantage normalization

因为优势的尺度会随任务、奖励设计、训练阶段不断变化。如果不做标准化，策略梯度更新容易因为尺度不稳定而抖动。

因此代码在默认情况下会把 advantage 做标准化：

$$
\hat{A}_t = \frac{A_t - \mu_A}{\sigma_A + 10^{-8}}
$$

这也是 PPO 中很常见的实践技巧。

## 4.5 `update()`：PPO 的核心优化步骤

`update()` 是整份 `ppo.py` 最值得反复读的部分。

### 第一步：生成 mini-batch

如果 actor/critic 是 recurrent 模型，就走 `recurrent_mini_batch_generator()`；否则走普通 `mini_batch_generator()`。

这说明 rollout storage 对前馈策略和循环策略做了统一适配，而 PPO 本体只需要根据 `is_recurrent` 选择生成器。

### 第二步：重新前向当前策略

这一步经常被初学者忽略。PPO 更新时并不是直接拿 rollout 里缓存的输出做 loss，而是：

- 用 rollout 中保存的动作 `a_t`；
- 重新用当前参数计算 `\log \pi_\theta(a_t|s_t)`；
- 再和旧的 `\log \pi_{\theta_{old}}(a_t|s_t)` 做比较。

于是比率为：

$$
r_t(\theta) = \exp\left(\log \pi_\theta(a_t|s_t) - \log \pi_{\theta_{old}}(a_t|s_t)\right)
$$

### 第三步：裁剪策略目标

PPO 的核心 surrogate objective 为：

$$
L^{CLIP}(\theta) = \mathbb{E}\left[\min\left(r_t(\theta)A_t,\; \text{clip}(r_t(\theta), 1-\epsilon, 1+\epsilon)A_t\right)\right]
$$

在实现里，因为是做最小化，所以会写成负号形式的 `surrogate_loss`。

它的直觉是：

- 如果新策略和旧策略差得不多，就正常做 policy gradient；
- 如果差得太多，就把更新裁住，避免一步走太远。

### 第四步：价值函数裁剪

代码里还实现了 clipped value loss，这一点很多人只记得 policy clip，却忽略 value 也能 clip。

做法是构造：

$$
V_{clip}(s_t) = V_{old}(s_t) + \text{clip}(V_\theta(s_t)-V_{old}(s_t), -\epsilon, \epsilon)
$$

然后比较：

- 未裁剪的 value MSE；
- 裁剪后的 value MSE；

取两者较大者。

这样做的直觉和 policy clip 一样：防止 value 网络单次更新过猛。

### 第五步：熵正则

总 loss 中包含：

$$
L = L_{surrogate} + c_v L_{value} - c_e H[\pi_\theta]
$$

其中熵项鼓励探索。`entropy_coef` 越大，策略越不容易过早塌缩成确定性输出。

### 第六步：自适应 KL 学习率

这是 `rsl_rl` 的 PPO 比较工程化的一点。

当 `schedule="adaptive"` 且设置了 `desired_kl` 时，代码会根据当前策略和旧策略之间的 KL 大小动态调学习率：

- KL 太大：学习率减小；
- KL 太小：学习率增大。

直觉是：

- 更新太激进，就踩刹车；
- 更新太保守，就给点油门。

对机器人任务来说，这比固定学习率更稳，尤其在训练早期和中后期策略变化速度差异很大时。

### 第七步：梯度裁剪与参数更新

策略和价值网络都会进行 `clip_grad_norm_`，防止梯度爆炸。然后调用 optimizer `step()`。

如果启用了 RND，还会额外更新 RND predictor。

---

# 五、PPO 的扩展：RND、对称性增强与多卡同步

这部分不一定是每个人一开始都会用到，但它恰恰说明 `rsl_rl` 已经不是“玩具 PPO”。

## 5.1 RND：给探索额外奖励

RND 的核心思想是：

- 目标网络固定；
- 预测网络去拟合目标网络输出；
- 某个状态越少见，预测误差越大；
- 于是预测误差可以当作 intrinsic reward。

简化地写：

$$
r_t^{int} \propto \| f_{pred}(s_t) - f_{target}(s_t) \|^2
$$

代码里，PPO 在 `process_env_step()` 时把 intrinsic reward 加入总奖励；在 `update()` 时单独优化 RND predictor。

这对稀疏奖励任务或者大地形探索任务会很有帮助。

## 5.2 Symmetry：让策略更符合机器人结构先验

很多足式机器人本身具有左右对称性。对这类系统，如果只靠数据自己学，策略未必会自然得到对称行为。

`symmetry_cfg` 提供了两种思路：

1. **数据增强**：把观测和动作做镜像扩增；
2. **镜像损失**：要求镜像后的输入，其策略输出也满足对应对称关系。

这相当于把“机器人的几何先验”直接写进损失函数或数据流里。

在机器人学习里，这种手段非常有价值，因为它能显著提高样本效率与步态一致性。

## 5.3 Multi-GPU：通过梯度规约同步参数

PPO 和 Distillation 都提供了 `broadcast_parameters()` 与 `reduce_parameters()`。

核心思路很直接：

- 主卡广播参数给其他卡；
- 各卡独立反向传播；
- 再把梯度做 `all_reduce` 求平均；
- 最后各卡做相同的 optimizer step。

这是一种比较直接、也比较透明的多卡实现方式。

不过阅读代码时我注意到一个值得留意的小地方：`ppo.py` 里 `broadcast_parameters()` 在附加了 `rnd.predictor.state_dict()` 后，后续给 `rnd.predictor` 加载的索引看起来仍然使用了 `model_params[1]`。从逻辑上看，这里更像是应当读取追加后的第三项。这个位置建议实际使用时再核对一遍版本实现，属于源码阅读中值得做笔记的地方。

---

# 六、Distillation：从 teacher 到 student 的策略蒸馏

如果说 PPO 解决的是“怎么学会策略”，那么 `distillation.py` 解决的是：

> **怎么把训练时强大的策略，压缩成部署时能用的策略。**

这在机器人 sim-to-real 里非常常见。

## 6.1 为什么机器人里经常要蒸馏

训练时你可能能用：

- 精确地形信息；
- 理想接触状态；
- 外力真值；
- 仿真中可直接读取的 privileged state。

但部署时，真实机器人通常只有：

- IMU；
- 关节编码器；
- 有时再加一个深度相机。

于是常见做法是：

1. 用 privileged information 训练一个强 teacher；
2. 再让 student 在受限观测下模仿 teacher；
3. 最终部署 student。

`rsl_rl` 的 Distillation 正是围绕这个场景设计的。

## 6.2 `act()`：student 真正执行，teacher 只给监督信号

在 `Distillation.act()` 里：

- student 用 `stochastic_output=True` 输出动作；
- teacher 则直接对同一步观测输出 `privileged_actions`。

然后这两者都会被存进 transition。

这里的思想是：

- 与环境交互的是 student；
- 监督标签来自 teacher；
- 存储的数据不是 `return` / `advantage`，而是“student 看到什么，teacher 会怎么做”。

## 6.3 `update()`：本质上就是 behavior cloning

蒸馏更新的核心 loss 很简单：

$$
L_{bc} = \mathbb{E}\left[\ell\big(a_{student}, a_{teacher}\big)\right]
$$

其中 `\ell` 可以是：

- MSE；
- Huber loss。

也就是说，这个 Distillation 类本质上是把 teacher policy 变成监督学习标签，然后训练 student 去拟合它。

### 一个很有意思的实现点：`gradient_length`

代码不是每个 batch 都 `step()`，而是累积到 `gradient_length` 次后再做一次反向传播与参数更新。这在 recurrent student 或长序列蒸馏里很有意义，你可以把它理解为一种更接近 **truncated BPTT / 梯度累积** 的实现方式。

### hidden state 的处理也很认真

Distillation 里会：

- 在 epoch 开始时恢复上次保存的 hidden states；
- 在更新中不断 `reset` 与 `detach_hidden_state`；
- 最后再把最新 hidden state 保存下来。

这说明作者在设计时并没有把蒸馏仅仅当作“最简单的监督学习”，而是考虑了 RNN 策略下的时序一致性。

## 6.4 为什么 Distillation 禁止 RND 和 Symmetry 扩展

在 `construct_algorithm()` 里，Distillation 明确拒绝 RND 和 symmetry 扩展。

原因很容易理解：

- RND 是探索机制，适用于强化学习采样，不适合简单行为克隆；
- symmetry 在蒸馏里不是不能做，而是这里的 Distillation 类希望保持目标单一：只做 teacher-student 行为拟合。

这也体现了 `rsl_rl` 代码风格的一个优点：**边界清楚，不把所有功能都糊成一个“大一统超级类”。**

---

# 七、理论与代码的对应关系总结

把上面内容浓缩一下，`rsl_rl` 这几份核心源码其实可以用一张表理解。

| 理论概念 | 代码位置 | 实现方式 |
| --- | --- | --- |
| 策略网络 $\pi_\theta(a\|s)$ | `MLPModel / CNNModel / RNNModel` | 高斯策略，支持状态相关或无关方差 |
| 价值函数 $V_\phi(s)$ | `critic` 模型 | 与 actor 共享统一模型接口，输出维度为 1 |
| GAE | `PPO.compute_returns()` | 反向递推 `delta` 与 `advantage` |
| PPO ratio | `PPO.update()` | `exp(new_log_prob - old_log_prob)` |
| PPO clip | `PPO.update()` | surrogate 与 clipped surrogate 取 max |
| value clip | `PPO.update()` | old value 附近裁剪 |
| entropy bonus | `PPO.update()` | 使用策略分布 entropy |
| intrinsic reward | RND 扩展 | 加到 extrinsic reward 上 |
| asymmetric actor-critic | `obs_groups` | actor / critic 使用不同观测集合 |
| sim-to-real 蒸馏 | `Distillation` | student 模仿 teacher 输出 |

所以这套源码最核心的思想可以总结成一句话：

> **用统一模型接口承载不同观测形式，再用统一算法接口承载不同训练范式。**

---

# 八、从足式机器人实践出发，如何理解这套库

下面站在“真的要拿这套代码训练机器人”的角度，说几个实践层面的理解。

## 8.1 先想清楚 actor 和 critic 各自看什么

很多训练不稳定，并不是 PPO 公式有问题，而是观测设计没想清楚。

一个很常见的做法是：

```python
obs_groups = {
    "actor": ["proprio", "command", "history"],
    "critic": ["proprio", "command", "history", "privileged"],
}
```

这样设计的好处是：

- actor 更接近部署场景；
- critic 更容易学准价值函数；
- 后续做蒸馏时也更自然。

## 8.2 什么时候该用 MLP、CNN、RNN

可以把选择原则记成一句话：

- **只有本体状态和命令**：优先 MLP；
- **有地形图、深度图等二维输入**：考虑 CNNModel；
- **部分可观测、强时序依赖明显**：考虑 RNNModel。

不要一上来就堆最复杂的结构。机器人强化学习里，很多问题先用干净的 MLP 基线跑通，往往效率最高。

## 8.3 归一化几乎是默认必选项

如果观测维度来自多个传感器，尺度通常差异很大。此时启用 `obs_normalization` 一般会更稳。

尤其是：

- 速度量和角度量混合；
- 接触状态与连续状态混合；
- 指令量和本体量混合。

在线归一化会显著降低“某几维数值过大、主导前向”的风险。

## 8.4 KL 自适应学习率很适合机器人 PPO

在机器人任务里，固定学习率经常会遇到两种问题：

- 前期太小，学得慢；
- 中期太大，策略发散。

`desired_kl + adaptive schedule` 给了一个非常实用的折中：以策略变化幅度为依据自动调节步长。

对大规模并行环境下的 PPO，这往往比手工猜学习率更省心。

## 8.5 蒸馏通常是“训练闭环”的最后一步

一条很常见的工程路线是：

1. 先训练一个用 privileged information 的 teacher；
2. 再把 teacher 蒸馏成 student；
3. 导出 student 为 JIT / ONNX；
4. 最后部署到真实控制栈。

从这个角度看，`rsl_rl` 的模型导出接口、student/teacher 抽象、obs_groups 设计，其实都不是零散功能，而是围绕一条完整落地链路服务的。

---

# 九、我对这套实现的评价

如果只看算法，`rsl_rl` 当然不是世界上唯一的 PPO 实现；但如果从机器人训练框架角度看，它有几个非常突出的优点。

## 9.1 优点

### （1）抽象层次清晰

- `MLP/CNN/RNN` 负责网络构件；
- `MLPModel/CNNModel/RNNModel` 负责策略/价值模型封装；
- `PPO/Distillation` 负责训练逻辑。

职责边界很清楚。

### （2）天然适合非对称观测与蒸馏

`TensorDict + obs_groups` 这个设计在机器人任务里非常顺手。

### （3）从训练一开始就考虑部署

JIT / ONNX 导出接口不是事后补丁，而是模型接口的一部分。

### （4）工程细节处理得比较完整

- timeout bootstrap
- recurrent hidden state 管理
- KL 自适应学习率
- 多卡梯度规约
- RND / symmetry 扩展

这些都说明它面向的是实际训练，而不仅是论文附带代码。

## 9.2 阅读源码时我会特别注意的两个点

### （1）`ppo.py` 中 RND 参数广播部分值得核对

前面提到过，`broadcast_parameters()` 对 `rnd.predictor` 的加载索引看起来可疑。实际使用时建议结合当前版本仓库再确认一下。

### （2）`Distillation.update()` 中最后不足 `gradient_length` 的累积 loss

当前实现是每当 `cnt % gradient_length == 0` 才执行一次 `backward + step`。这意味着如果一个 epoch 最后剩下的 batch 数不足 `gradient_length`，最后那部分累积 loss 不会在循环结尾额外补一次更新。是否有意如此，要看外部 batch 组织方式；但从阅读体验上看，这也是一个值得留意的实现细节。

这些地方并不影响我们理解整体设计，反而是源码解读时很有价值的“细读笔记”。

---

# 十、总结

如果要我用一句话概括 `rsl_rl` 这几份核心源码，我会这样说：

> **它不是单纯把 PPO 写出来，而是围绕机器人强化学习，把“观测组织—模型表达—策略更新—蒸馏部署”做成了一条连贯的工程链。**

从理论上看，它覆盖了 PPO 的经典核心：

- 高斯策略；
- GAE；
- clipped surrogate objective；
- clipped value loss；
- entropy regularization；
- KL 自适应学习率。

从工程上看，它又把机器人训练里最常见的现实问题考虑进来了：

- 非对称 actor-critic；
- 多模态观测（1D / 2D / 时序）；
- RNN hidden state 管理；
- teacher-student 蒸馏；
- 导出部署。

所以学习 `rsl_rl` 的最好方式，并不是把它当成“某个库的源码”，而是把它当成一个很成熟的 **机器人强化学习工程模板**。如果你能把这套设计思想读懂，之后无论是改自己的足式机器人任务，还是实现新的 RL 算法，都会轻松很多。

---

# 附：可以怎么继续往下读

如果你准备继续深入 `rsl_rl`，建议下一步重点看这几类内容：

1. `RolloutStorage`：理解样本是如何组织、切 mini-batch 和 recurrent batch 的；
2. Runner / OnPolicyRunner：理解训练主循环如何调 `act -> env.step -> process_env_step -> compute_returns -> update`；
3. 环境端 `VecEnv`：理解并行仿真如何喂给算法；
4. 具体任务配置：理解 `obs_groups`、网络配置、PPO 超参数在真实任务里怎么设。

等把这些也串起来，你对 `rsl_rl` 的理解就会从“能看懂源码”变成“能自己改库、能自己搭训练系统”。
