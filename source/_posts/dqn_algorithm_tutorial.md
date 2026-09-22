---
title: 从 Q-learning 到 DQN，一步步推演
mathjax: true
tags:
    - 强化学习
    - DQN
    - 深度学习
    - 算法
categories: 强化学习
cover: https://img.cdn1.vip/i/695e790568d31_1767799045.webp
---

# DQN 算法超详尽教程——从 Q-table 到深度强化学习

如果说 Q-learning 是强化学习的"Hello World"，那 DQN（Deep Q-Network）就是深度强化学习真正走出实验室、进入公众视野的里程碑。2013 年，DeepMind 的 Mnih 等人在 NIPS 发表 *Playing Atari with Deep Reinforcement Learning*，用一个卷积神经网络直接从原始像素输入学到了 Atari 2600 平台上 6 款游戏（后来扩展到 49 款）中超越人类专业玩家水平的控制策略。这篇工作的冲击力在于：它首次干净利落地证明了，深度神经网络可以在强化学习框架下进行稳定训练，而不需要任何手工特征工程。两年后，这篇论文的改进版登上了 *Nature*，标题只有三个词：*Human-level control through deep reinforcement learning*。从此，深度强化学习进入了爆发期。

DQN 之所以经典，不在于它用了多复杂的数学工具，而在于它用两个看似简单的工程技巧——经验回放（Experience Replay）和目标网络（Target Network）——破解了一个困扰学界多年的死结：如何在一个非平稳的数据分布上训练深度神经网络。这篇文章的目标是把 DQN 从问题动机到数学推导、从伪代码到 PyTorch 实现、从基础原理到改进变体的整条链路，以科研论文式的结构拆解清楚。

---

## 1. 问题溯源：Q-learning 为何在"大世界"中失效

Q-learning 的核心是一张表格：对于每一个离散状态 $s$ 和离散动作 $a$，在表格中维护一个标量 $Q(s, a)$，表示在状态 $s$ 下采取动作 $a$ 所能获得的期望累积回报的估计值。每一次智能体与环境交互，产生一组 $(s, a, r, s')$ 转移，Q-learning 就按照著名的 Bellman 最优方程的采样形式更新一个条目：

$$
Q(s, a) \leftarrow Q(s, a) + \alpha \left[ r + \gamma \max_{a'} Q(s', a') - Q(s, a) \right]
$$

这个更新规则在理论上是收敛的——当每个状态-动作对被无限次访问，且步长 $\alpha$ 满足 Robbins-Monro 条件时，$Q$ 将以概率 1 收敛到最优动作价值函数 $Q^*$。然而，这一优雅的理论结果建立在一个隐含前提之上：状态空间和动作空间都足够小，使得遍历访问成为可能。

一旦状态空间膨胀到一定程度——比如 Atari 游戏的一帧 $84 \times 84$ 灰度图像对应了 $256^{7056}$ 种可能的观测——表格方法就彻底失效了。不仅是存储问题，更根本的是泛化问题：Q-learning 对表格中的每一个格子独立更新，无法将一个状态中学到的规律迁移到另一个相似状态。直觉告诉我们，屏幕上一架太空飞船向左平移一个像素，它的最优动作应该几乎不变，但 Q-table 对此毫无知觉。

这就是函数逼近（Function Approximation）登场的地方。我们不再维护一张离散表格，而是用一个参数化函数 $Q(s, a; \theta)$ ——在 DQN 中就是一个深度神经网络——来拟合动作价值函数。参数 $\theta$ 使得函数可以跨状态泛化：相近的状态会得到相近的 Q 值预测，经验的效用从"点"扩展到了"邻域"。

然而，把神经网络放进强化学习循环中并不是简单地替换一张表。它带来三个深层问题：第一，深度学习的核心假设是数据独立同分布（i.i.d.），而强化学习的数据是序贯采样的，具有强时序相关性；第二，监督学习的目标是固定的，而强化学习中的目标值 $r + \gamma \max_{a'} Q(s', a'; \theta)$ 本身依赖于正在被优化的参数 $\theta$，形成了一个"追着自己尾巴跑"的困境；第三，深度网络的训练需要大量梯度更新，而每更新一次参数，数据分布就会漂移，原本学到的表示可能瞬间过时。DQN 用两个精巧的设计同时解决了这三个问题。

---

## 2. 经验回放：让序贯数据"看起来像" i.i.d.

强化学习的数据流是时间相关的：$t$ 时刻的状态 $s_t$ 决定了 $t+1$ 时刻的状态 $s_{t+1}$，因此从时间线的视角看，相邻的样本高度相似。如果直接把这些序贯样本逐个喂给神经网络做 SGD，梯度会在某个局部方向上持续累积，导致网络过度拟合近期经验而遗忘此前学到的策略，即灾难性遗忘（catastrophic forgetting）。更隐蔽的问题在于，这种按时间排序的训练数据使得梯度更新的方差极大——因为一个 episode 内部的样本远非独立，无法满足 SGD 收敛理论中对梯度无偏估计的要求。

经验回放（Experience Replay）的思想直接而有效：维护一个固定容量的经验池（Replay Buffer）$\mathcal{D}$，容量记为 $N$（典型值 $10^5$ 到 $10^6$）。智能体与环境每交互一步，产生一个 transition $(s_t, a_t, r_t, s_{t+1})$，将其存入经验池；当池满时，最旧的 transition 被覆盖。训练时，从 $\mathcal{D}$ 中**均匀随机采样**一个大小为 $B$ 的 mini-batch 来计算梯度：

$$
\nabla_{\theta} L(\theta) = \frac{1}{B} \sum_{(s,a,r,s') \in \text{batch}} \nabla_{\theta} \left( r + \gamma \max_{a'} Q(s', a'; \theta) - Q(s, a; \theta) \right)^2
$$

这一步看似简单，但解决了好几个层面的问题。首先是打破了时序相关性——一个 mini-batch 里的样本来自完全不同的时间点和 episode，近似满足了 SGD 对数据独立性的要求。其次，每个 transition 不再是一次性消耗品，它可以被反复采样多次，用于多轮参数更新，极大地提高了样本效率。更重要的是，经验池充当了一种"历史缓存"：即使智能体当前的策略已经有了很大变化，池中依然保存着旧策略采样出的数据，这迫使网络在一个更多样、更平稳的数据分布上训练，平滑了策略切换带来的分布漂移。

一个实现细节值得注意：在训练的最初阶段（通常称为 warm-up 阶段，约 $5 \times 10^4$ 步），智能体仅用随机策略收集经验，不进行任何参数更新。只有经验池中积累了足够多的数据后，才开始从池中采样训练。这确保了训练起始时梯度估计的方差是可控的。

---

## 3. 目标网络：给追逐者一个"固定靶"

即使有了经验回放来稳定数据分布，损失函数本身仍然包含一个微妙的不稳定性。标准 DQN 的损失定义为：

$$
L(\theta) = \mathbb{E}_{(s,a,r,s') \sim \mathcal{D}} \left[ \left( r + \gamma \max_{a'} Q(s', a'; \theta) - Q(s, a; \theta) \right)^2 \right]
$$

注意，这里目标值 $y = r + \gamma \max_{a'} Q(s', a'; \theta)$ 和当前网络输出 $Q(s, a; \theta)$ **依赖同一组参数 $\theta$**。当我们用梯度下降来降低 $L(\theta)$ 时，我们不仅拉近 $Q(s, a; \theta)$ 朝 $y$，同时 $y$ 本身也在随着 $\theta$ 的更新而移动。形象地说，这就像一个人追着自己的影子跑——每一步移动，影子也跟着移动，不仅永远追不上，还可能陷入无休止的震荡。更深层地，这种自举（bootstrapping）+ 函数逼近 + off-policy 三者的组合，正是 Sutton 和 Barto 早在 1990 年代就指出的可能导致强化学习发散和崩塌的"死亡三合会"（deadly triad）。

DQN 的解决方案是引入第二个神经网络，称为**目标网络**（Target Network），记为 $Q(s, a; \theta^{-})$。这个网络的结构与主网络（记为 $Q(s, a; \theta)$）完全相同，但它的参数 $\theta^{-}$ 并非每一步都更新，而是每隔固定的 $C$ 步才从主网络拷贝一次：

$$
\theta^{-} \leftarrow \theta \quad \text{（hard update）}
$$

损失函数随之变为：

$$
L(\theta) = \mathbb{E}_{\mathcal{D}} \left[ \left( r + \gamma \max_{a'} Q(s', a'; \theta^{-}) - Q(s, a; \theta) \right)^2 \right]
$$

现在，在两次目标网络更新之间的 $C$ 步内，目标值 $y = r + \gamma \max_{a'} Q(s', a'; \theta^{-})$ 是固定的——目标网络参数 $\theta^{-}$ 不变。主网络的梯度下降有了一个静止的瞄准点，训练变成了真正的监督回归问题。当主网络经过 $C$ 步优化收敛到当前目标附近后，再同步一次目标网络，将"标靶"移动到更优的位置。这种周期性同步的策略创造了一种围绕优化问题的"准静态"假设，在实践中被证明足以让网络稳定收敛。

这里有一个常见的误解需要澄清：目标网络并不是用"旧"的参数来估计一个近似目标——在两次同步之间，目标网络确实使用的是旧参数，但正因为它是"旧"的，它不会随着主网络的每一次更新而漂移，从而为优化提供了稳定的回归目标。$C$ 的选择是一个权衡：太大会拖慢学习进度，太小则目标网络更新太频繁，退化回没有目标网络的情形。论文中的典型取值为 $C = 10^4$ 步。

---

## 4. 网络结构设计：从像素到 Q 值

DQN 在两篇标志性论文中采用了一个统一的卷积神经网络架构来处理 Atari 游戏的原始视觉输入。这个网络值得详细拆解，因为它奠定了后续大量视觉强化学习工作的基础架构范式。

**输入层**：网络接收的并非单帧画面，而是连续 4 帧 $84 \times 84$ 灰度图像的堆叠，输入张量维度为 $84 \times 84 \times 4$。四帧堆叠的意义在于让网络能够捕获运动信息——单帧图像中一架向右飞行的太空飞船和一架向左飞行的看起来可能一样，但连续四帧输入给出了速度向量的完整信息。这等价于使环境从部分可观测马尔可夫决策过程（POMDP）退化为马尔可夫决策过程（MDP），恢复了马尔可夫性。

**卷积层序列**：

$$
\begin{aligned}
\text{Conv1}&\text{: } 32 \text{ filters, } 8\times8 \text{ kernel, stride } 4, \text{ReLU} \\
\text{Conv2}&\text{: } 64 \text{ filters, } 4\times4 \text{ kernel, stride } 2, \text{ReLU} \\
\text{Conv3}&\text{: } 64 \text{ filters, } 3\times3 \text{ kernel, stride } 1, \text{ReLU}
\end{aligned}
$$

三层卷积逐步压缩空间维度、扩展通道维度，最后经 Flatten 拉平后接入一个 512 维全连接层，再输出一个 $|\mathcal{A}|$ 维向量，每个维度对应一个动作的 Q 值估计。值得注意的是，DQN 的输出不是 $(s, a)$ 对输入后的一个标量，而是**一次性输出所有动作的 Q 值**——给定状态 $s$，一次前向传播即得到全部动作的估计，无需对每个动作独立计算。前向传播的输出是一个向量：

$$
\mathbf{q} = [Q(s, a_1; \theta), Q(s, a_2; \theta), \dots, Q(s, a_{|\mathcal{A}|}; \theta)]
$$

这种"输出层等于动作数"的设计在计算上极为高效，也成为后续所有离散动作 DRL 算法的标准。

对于非视觉输入的场景——比如状态是关节角度、IMU 读数、机器人本体传感器等向量形式的数据——网络可以简化为一个全连接架构：输入层接两层 128 维或 256 维的全连接层（带 ReLU 激活），输出层同样是 $|\mathcal{A}|$ 维。网络架构的选择并不影响算法的核心逻辑，只要输入能够编码状态的充分统计信息即可。

---

## 5. 算法流程的完整推导

设强化学习环境建模为 MDP $\langle \mathcal{S}, \mathcal{A}, P, R, \gamma \rangle$，其中状态空间 $\mathcal{S}$ 连续（或高维离散），动作空间 $\mathcal{A}$ 离散。我们的目标是学习一个参数化函数 $Q(s, a; \theta)$ 来近似最优动作价值函数 $Q^*(s, a) = \max_{\pi} \mathbb{E}_{\pi} \left[ \sum_{k=0}^{\infty} \gamma^k r_{t+k} \mid s_t = s, a_t = a \right]$。

参数 $\theta$ 通过最小化以下均方 Bellman 误差来学习：

$$
L(\theta) = \mathbb{E}_{(s,a,r,s') \sim \mathcal{D}} \left[ \left( y - Q(s, a; \theta) \right)^2 \right]
$$

其中目标值 $y$ 由目标网络给出：

$$
y = r + \gamma \max_{a'} Q(s', a'; \theta^{-})
$$

若 $s'$ 为终止状态，$y = r$。这个目标值的构造方式来自对最优 Bellman 方程 $Q^*(s, a) = r + \gamma \max_{a'} Q^*(s', a')$ 的半梯度近似——目标网络参数 $\theta^{-}$ 在梯度计算中被视为常数，不参与求导，因此称为"半梯度"方法（semi-gradient）。损失 $L(\theta)$ 对 $\theta$ 的梯度为：

$$
\nabla_{\theta} L(\theta) = -2 \cdot \mathbb{E}_{\mathcal{D}} \left[ (y - Q(s, a; \theta)) \cdot \nabla_{\theta} Q(s, a; \theta) \right]
$$

在实际实现中，mini-batch SGD 执行的更新步骤为：

$$
\theta \leftarrow \theta + \alpha \frac{1}{B} \sum_{j=1}^{B} (y_j - Q(s_j, a_j; \theta)) \cdot \nabla_{\theta} Q(s_j, a_j; \theta)
$$

行为策略使用 $\varepsilon$-greedy 探索：以概率 $\varepsilon$ 随机选择动作，以概率 $1 - \varepsilon$ 选择 $\arg\max_a Q(s, a; \theta)$。$\varepsilon$ 通常从 1.0 线性衰减到 0.1 或 0.01，以平衡探索（exploration）和利用（exploitation）的经典矛盾。

需要强调的是，DQN 是一种 off-policy 算法——行为策略（$\varepsilon$-greedy）和目标策略（greedy）可以不同，这是 Q-learning 系列算法的固有优势。经验回放也天然支持 off-policy 训练：池中存储旧策略产生的数据，训练时采样这些数据来更新当前策略的 Q 函数，这在 on-policy 方法中是无法做到的。

---

## 6. 训练稳定性的工程细节

将上述理论转化为可运行的代码，有几个工程细节看似琐碎，实际上往往是训练成败的分水岭。

**Reward Clipping**：在不同游戏中，奖励的尺度可能相差数个量级——某个游戏的分数是 1 分 1 分地增长，另一个游戏可能直接给出 +10000。这种尺度差异会通过损失函数放大为巨大的梯度，轻易破坏训练。原始 DQN 论文的解决方案简单而有效：将所有正奖励截断为 $+1$，所有负奖励截断为 $-1$，零奖励保持为零。这一操作牺牲了奖励函数的精确值来换取梯度稳定性。对于不涉及跨环境泛化的单一任务训练，也可以使用 reward scaling（除以标准差）或分级奖励来替代截断，但截断仍然是入门阶段最稳妥的选择。

**Huber Loss**：均方误差（MSE）对大误差的惩罚是二次的，这在大 TD error 出现时会产生超大梯度。论文改用截断后的 MSE（即 $y$ 被 clamp 到 $[-1, 1]$ 后计算损失），等价于使用 Huber loss：

$$
L_{\text{Huber}}(\delta) = \begin{cases}
\frac{1}{2}\delta^2 & |\delta| \leq 1 \\
|\delta| - \frac{1}{2} & |\delta| > 1
\end{cases}
$$

其中 $\delta = y - Q(s, a; \theta)$。Huber loss 在小误差区间保持 MSE 的平滑性，在大误差区间切换为 MAE 的鲁棒性，防止个别异常样本主导梯度方向。

**Warm-up 与初始探索**：训练的最初若干步不进行任何参数更新，仅用探索策略（高 $\varepsilon$）收集经验填充缓冲池。这是为了给 SGD 准备一个多样化的初始 batch，避免训练从一开始就坍缩到某个狭窄的经验域。典型的 warm-up 步数为 $5 \times 10^4$。

**目标网络同步时机**：每隔 $C$ 步执行 $\theta^{-} \leftarrow \theta$。$C$ 的选取没有金标准，但它必须大于一次训练期内经验分布发生显著变化的时间尺度。太小（如每步同步）退化回无目标网络的状态，太大则目标值过于陈旧，滞后于策略的进展。$10^3 \sim 10^4$ 是经验验证出的合理窗口。

**梯度裁剪**：即使使用了 Huber loss，偶发的极端梯度仍然可能出现。实践中常用的做法是对梯度的 $L_2$ 范数进行裁剪（如裁剪到 10），这可以在 PyTorch 中用 `torch.nn.utils.clip_grad_norm_` 一行代码实现，是对训练稳定性的最后一道保险。

---

## 7. $\varepsilon$-greedy 的衰减策略及其理论动机

探索与利用的权衡是强化学习中最基本也最微妙的问题，$\varepsilon$-greedy 策略是它最朴素的解法。在训练初期，网络参数随机初始化，Q 值的估计几乎毫无意义，此时选择 $\arg\max_a Q(s, a; \theta)$ 并不能提供有效的学习信号——智能体只是在追逐随机的 Q 值噪声。因此训练起步时需要较高的随机探索概率来收集多样化的经验，让 Q 函数有机会在广泛的状态-动作空间中获得"第一个合理的估计"。随着训练的推进，Q 函数逐渐变得可靠，$\varepsilon$ 线性衰减到较低水平，让智能体更多地利用已学到的知识。

常见的线性衰减公式为：

$$
\varepsilon = \max \left( \varepsilon_{\min},\; \varepsilon_{\text{init}} - \frac{t}{T_{\text{decay}}} (\varepsilon_{\text{init}} - \varepsilon_{\min}) \right)
$$

其中 $t$ 是当前步数，$T_{\text{decay}}$ 是衰减持续的步数。$\varepsilon_{\min}$ 保持在 0.01 到 0.1 之间，目的是保留永久的最小探索——在非平稳环境或对手会适应的场景中，完全关闭探索是不可取的。

理论上，$\varepsilon$-greedy 的收敛性在表格案例中已得到证明：只要满足 GLIE（Greedy in the Limit with Infinite Exploration）条件，即每个状态-动作对被无限次访问，且策略最终趋向贪婪，Q-learning 就能收敛到最优。在函数逼近的情况下，严格的收敛保证不再成立，但 $\varepsilon$-greedy 配合经验回放和目标网络在实践中被反复验证为可靠的探索机制。

---

## 8. PyTorch 实现：从模块到完整 Agent

下面给出一个可以直接运行的 DQN 实现，结构清晰，注释精简，适合作为实验基准。我们将组件拆为三个部分：网络模型、经验回放池、以及 DQN Agent 主体。

**网络模型**——输入状态维度，输出各动作的 Q 值：

```python
import torch
import torch.nn as nn
import torch.nn.functional as F


class DQN(nn.Module):
    def __init__(self, state_dim, action_dim, hidden_dim=128):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(state_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, action_dim)
        )

    def forward(self, x):
        return self.net(x)
```

**经验回放池**——环形缓冲区，随机采样 mini-batch：

```python
import numpy as np
from collections import deque
import random


class ReplayBuffer:
    def __init__(self, capacity):
        self.buffer = deque(maxlen=capacity)

    def push(self, state, action, reward, next_state, done):
        self.buffer.append((state, action, reward, next_state, done))

    def sample(self, batch_size):
        batch = random.sample(self.buffer, batch_size)
        states, actions, rewards, next_states, dones = zip(*batch)
        return (
            torch.FloatTensor(np.array(states)),
            torch.LongTensor(actions),
            torch.FloatTensor(rewards),
            torch.FloatTensor(np.array(next_states)),
            torch.FloatTensor(dones)
        )

    def __len__(self):
        return len(self.buffer)
```

**DQN Agent**——核心逻辑包含动作选择（带 $\varepsilon$-greedy 衰减）、经验存储和参数更新：

```python
class DQNAgent:
    def __init__(self, state_dim, action_dim, lr=1e-3, gamma=0.99,
                 epsilon=1.0, eps_min=0.01, eps_decay=5000,
                 target_update=100, buffer_capacity=10000, batch_size=64):
        self.action_dim = action_dim
        self.gamma = gamma
        self.epsilon = epsilon
        self.eps_min = eps_min
        self.eps_decay = eps_decay
        self.target_update = target_update
        self.batch_size = batch_size
        self.step_count = 0

        self.q_net = DQN(state_dim, action_dim)
        self.target_net = DQN(state_dim, action_dim)
        self.target_net.load_state_dict(self.q_net.state_dict())
        self.target_net.eval()

        self.optimizer = torch.optim.Adam(self.q_net.parameters(), lr=lr)
        self.buffer = ReplayBuffer(buffer_capacity)

    def select_action(self, state):
        self.step_count += 1
        self.epsilon = max(self.eps_min,
            self.epsilon - (self.epsilon - self.eps_min) / self.eps_decay)

        if np.random.random() < self.epsilon:
            return np.random.randint(self.action_dim)

        state_tensor = torch.FloatTensor(state).unsqueeze(0)
        with torch.no_grad():
            q_values = self.q_net(state_tensor)
        return q_values.argmax().item()

    def update(self):
        if len(self.buffer) < self.batch_size:
            return None

        states, actions, rewards, next_states, dones = \
            self.buffer.sample(self.batch_size)

        q_values = self.q_net(states).gather(1, actions.unsqueeze(1)).squeeze(1)

        with torch.no_grad():
            next_q_values = self.target_net(next_states).max(dim=1)[0]
            targets = rewards + self.gamma * next_q_values * (1 - dones)

        loss = F.mse_loss(q_values, targets)

        self.optimizer.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(self.q_net.parameters(), 10.0)
        self.optimizer.step()

        if self.step_count % self.target_update == 0:
            self.target_net.load_state_dict(self.q_net.state_dict())

        return loss.item()
```

这段代码中有几个值得展开的细节。首先是 `self.target_net.eval()` ——目标网络全程处于 eval 模式，因为它不需要反向传播，置为 eval 可以关闭 dropout 和 batch normalization 等训练特有的行为，确保目标值计算的一致性。其次是在 `with torch.no_grad()` 上下文中计算目标值，这阻止 PyTorch 构建关于目标网络的计算图，节省内存并确保梯度只流向主网络。`(1 - dones)` 这个乘子优雅地处理了终止状态：当 `done == 1` 时，第二项归零，目标退化为即时奖励本身，这是对 Bellman 方程中终止状态无未来价值的精确编码。

---

## 9. 训练循环与评估

完整的训练循环将上述组件串联成一个自洽的实验流程：

```python
def train(env, agent, num_episodes):
    episode_rewards = []

    for episode in range(num_episodes):
        state, _ = env.reset()
        total_reward = 0
        done = False

        while not done:
            action = agent.select_action(state)
            next_state, reward, terminated, truncated, _ = env.step(action)
            done = terminated or truncated

            agent.buffer.push(state, action, reward, next_state, done)
            loss = agent.update()

            state = next_state
            total_reward += reward

        episode_rewards.append(total_reward)

        if (episode + 1) % 100 == 0:
            avg = np.mean(episode_rewards[-100:])
            print(f"Episode {episode+1:5d} | "
                  f"Avg Reward (100 ep): {avg:8.2f} | "
                  f"Epsilon: {agent.epsilon:.3f}")

    return episode_rewards
```

用 Gymnasium 的 CartPole-v1 跑一个基线实验：state_dim=4, action_dim=2, num_episodes=1000。如果你亲眼看到 reward 曲线从起初的几十步就倒下（episode 结束时杆子倾倒），到中期跌跌撞撞撑住几百步，再到后期连续数千步不倒、reward 触及环境上限（500），你就能直观体会到 Q 函数是如何在一次次试错中被"雕刻"出正确形状的。这条曲线本身就是理解 DQN 的最佳注释。

---

## 10. Q 值高估问题与 Double DQN

DQN 的一个被充分研究的缺陷是其系统性高估 Q 值的倾向。这个问题的根源在于目标值的构造方式：

$$
y = r + \gamma \max_{a'} Q(s', a'; \theta^{-})
$$

这里的 $\max$ 操作同时对真实 Q 值和估计噪声取最大值。即使目标网络 $Q(s', a'; \theta^{-})$ 在每个动作上的估计都是无偏的（即期望等于真实 Q），对这些无偏估计取最大值后得到的量也必然大于等于真实的 $\max$——这是一种由统计极值特性导致的系统性偏差。更通俗地说，有一组从真实值附近随机波动的数，你从中挑出最大的那个，它几乎总是高于真实的那个最大值。这就是估计理论中著名的 supremum of noise 问题。

Hado van Hasselt 等人在 2015 年提出了一个优雅的解耦方案，称为 Double DQN（DDQN）。其核心洞察是：$\max$ 操作可以分解为两步——**选择**一个动作，和**评估**被选中的那个动作。DQN 让同一个目标网络同时做这两件事，因此高估被放大；Double DQN 让**主网络负责选择动作**、让**目标网络负责评估**：

$$
y = r + \gamma Q\left(s', \arg\max_{a'} Q(s', a'; \theta);\; \theta^{-}\right)
$$

直观上，主网络在这个状态下可能高估动作 $a_1$、低估动作 $a_2$，而目标网络的估计噪声分布和主网络不完全一致，因此主网络"偏爱"的动作被目标网络重新评估后，高估倾向被显著抑制。这一操作不引入新的超参数，不增加额外计算开销，仅需改动一行代码，却能够稳定降低 Q 值的估计偏差。在代码层面，改动从：

```python
next_q_values = self.target_net(next_states).max(dim=1)[0]
```

变为：

```python
next_actions = self.q_net(next_states).argmax(dim=1, keepdim=True)
next_q_values = self.target_net(next_states).gather(1, next_actions).squeeze(1)
```

仅此而已。Double DQN 是 DQN 最"物美价廉"的升级，几乎已成为标准 DQN 实现的一部分。

---

## 11. Dueling DQN 与价值分解

Dueling DQN（Wang et al., 2016）从网络结构的层面入手，提出将 Q 值拆分为两部分：状态价值 $V(s)$ 和优势函数 $A(s, a)$。这里 $V(s) = \max_a Q(s, a)$ 表示"处于当前状态本身有多好"，$A(s, a) = Q(s, a) - V(s)$ 表示"相对于当前状态的平均水平，做这个动作能带来多少额外的价值"。

Dueling 架构用同一个卷积层提取底层特征，然后分叉为两个全连接头——一个输出标量 $V(s)$，一个输出 $|\mathcal{A}|$ 维向量 $A(s, a)$——最后按如下方式重组为 Q 值：

$$
Q(s, a; \theta, \alpha, \beta) = V(s; \theta, \alpha) + \left( A(s, a; \theta, \beta) - \frac{1}{|\mathcal{A}|} \sum_{a'} A(s, a'; \theta, \beta) \right)
$$

减去均值 $\frac{1}{|\mathcal{A}|} \sum_{a'} A(s, a')$ 是为解决可辨识性问题——如果不做这个约束，$V$ 和 $A$ 的分解有无穷多种可能：你可以从 $A$ 的每个分量各减一个常数，再加回 $V$ 上，Q 值完全不变。减去均值后强制 $\sum_a A(s, a) = 0$，分解是唯一的。当然也可以选择用 $\max_a A(s, a)$ 替代均值，但均值在实践中更稳定。

Dueling 结构的优势在于一种重要的泛化模式：有些状态下，所有动作的价值几乎相同（比如车辆在空旷直道上），此时精确区分动作不如准确估计"这个状态总体有多好"重要。标准 DQN 必须通过对每个动作的输出各自调整才能学到这一点，而 Dueling DQN 的 $V(s)$ 头可以独立于动作学习状态价值。这是将先验知识（Q 值可分解为状态价值与动作优势）编码进网络结构的典型案例。

---

## 12. 从 DQN 到 Rainbow：集大成之路

在 DQN 提出后的短短三年内，学界涌现了大量改进方案，各自针对 DQN 的不同缺陷。2017 年，DeepMind 的 Hessel 等人做了一项雄心勃勃的消融实验——他们将六项独立改进打包在一起，取名为 Rainbow，考察它们在多大程度上互补或重叠。

这六项改进分别是：

**Double DQN** 解决 Q 值高估问题；**Dueling DQN** 分解状态价值和动作优势以提升泛化；**Prioritized Experience Replay（PER）**按 TD error 的绝对值给经验加权采样，让网络优先学习那些它"还没学会"的 transition，配合重要性采样权重修正非均匀采样带来的偏差；**Multi-step Learning** 不再只向前看一步，而是用 $n$ 步的累积奖励（加上 $n$ 步后状态的 Q 值）作为目标，在偏差和方差之间提供一个可调的权衡；**Distributional RL** 不再输出 Q 值（一个期望值），而是输出回报的完整概率分布，更丰富地编码了不确定性信息；**Noisy Nets** 用可学习的参数化噪声替代 $\varepsilon$-greedy 中的随机探索，让探索策略本身也参与梯度优化。

Rainbow 的实验结果令人印象深刻：六项改进并非简单叠加，而是产生了正向的协同效应——组合后的效果优于任何单一改进。在 Atari 基准上，Rainbow 的中位数人类归一化分数达到了约 220%，大幅超过原始 DQN 和任何单一优化。

---

## 13. 在机器人控制中的应用与适配

对于足式机器人等实际控制问题，DQN 的适用范围取决于动作空间的类型。如果控制问题可以被合理离散化——比如步态模式选择（小跑 / 溜蹄 / 跳跃）、运动方向切换、或者作为层级控制框架中的高层决策器——DQN 系列算法完全适用且效果可观。

在离散控制场景中，DQN 可以与底层控制器（如 MPC、阻抗控制、PD 控制器）形成天然的层级结构：上层 DQN 选择宏观行为模式，底层控制器负责任务空间到关节力矩的精细映射。这种分层的设计既利用 DQN 在高维状态下的决策泛化能力，又保留了模型底层控制在物理可行性上的保证，是一种工程上非常务实的融合方式。

然而需要清醒认识的是，绝大多数足式机器人的底层控制天然是连续的——关节力矩是连续量，落足点的空间坐标也是连续的。要处理连续动作空间，需要使用策略梯度系列算法（DDPG、TD3、SAC）或它们与 Q-learning 的混合体。DQN 在这些场景中的角色更接近于思想基础和概念框架，而非直接可用的工具。

样本效率是另一个实际瓶颈。DQN 需要数百万甚至上千万步交互才能收敛到一个可靠的策略。对于真实的物理机器人，每一次交互都消耗时间和磨损硬件，这个数量级的交互往往不可行。这一局限推动了 Sim-to-Real 转移、Model-Based RL、以及高度并行的仿真环境（如 Isaac Gym）的发展——在仿真中预训练，再迁移到实物，是目前最可行的手段。

---

## 结语

DQN 的贡献不在于数学上的精巧——它的核心公式几乎完全继承自 1989 年的 Q-learning，奖励函数、折扣因子、Bellman 方程一个都没改。它真正的贡献在于证明了：只要把经验回放和目标网络这两个看似朴素的工程技巧加进去，深度神经网络就可以在强化学习中稳定训练。

从算法演化谱系看，DQN 是深度强化学习大厦的地基：

$$
\begin{aligned}
\text{Q-learning (Watkins, 1989)} &\to \text{DQN (Mnih et al., 2013/2015)} \\
&\to \text{DDQN (van Hasselt, 2015)} \\
&\to \text{Dueling DQN (Wang, 2016)} \\
&\to \text{Rainbow (Hessel, 2017)} \\
&\to \text{DDPG / TD3 / SAC (连续控制，2015-2018)}
\end{aligned}
$$

如果你正在系统学习深度强化学习，建议沿着 Q-learning → DQN → DDQN → DDPG → TD3 → SAC 的顺序推进，并在每个节点用 CartPole、LunarLander、Pendulum 等经典环境跑通代码。当你亲眼看到 Q 函数的曲面在训练步数的推进下，从一个随机的凹凸不平的曲面逐步"焊接"成一条清晰的梯度脊线时，那些公式就不再只是纸上的符号了。

DQN 教会我们的最重要的一课，或许不是某个具体的公式或技巧，而是一种工程心态：面对非平稳性、相关性和不稳定性，有时最简单的 idea——缓存历史、周期性固定目标——比复杂的数学修正更有效，也更经得起时间的检验。
