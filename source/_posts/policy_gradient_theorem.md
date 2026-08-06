---
title: 策略梯度定理推导
date: 2026-08-07
mathjax: true
tags:
    - 强化学习
    - 策略梯度
    - 数学
categories: 强化学习
---

# 策略梯度定理推导

这篇东西是我自己推导策略梯度定理时顺手记下来的。网上关于这个定理的资料不少，但大多数要么跳步太厉害，要么在关键的地方语焉不详——比如那个"交叉项等于零"到底为什么等于零，比如 $P_\theta(s_t=s)$ 到底能不能提到梯度外面。所以我把每一步都写了下来，主要是给自己看的，顺便整理成一篇能读的东西。

## 前置设定

无限时域折扣 MDP，老规矩：

- 状态空间 $\mathcal{S}$，动作空间 $\mathcal{A}$
- 环境状态转移核：$P(s'|s,a)$（环境动力学，**与策略参数 $\theta$ 无关**）
- 参数化策略：$\pi_\theta(a|s)$
- 折扣因子：$\gamma\in[0,1)$
- 轨迹：$\tau=(s_0,a_0,s_1,a_1,\dots)$
- 单步奖励：$r(s_t,a_t)$
- 回报（从时刻 $t$ 开始）：

$$
G_t = \sum_{k=t}^{\infty}\gamma^{k-t}r(s_k,a_k)
$$

这里顺便提一下两种常见的目标函数定义——后面会看到，选哪个会影响最终公式前面有没有那个 $\frac{1}{1-\gamma}$ 的系数。

定义1（原始无归一）：

$$
J(\theta)=\mathbb{E}_{\tau\sim p_\theta(\tau)}\left[\sum_{t=0}^{\infty}\gamma^t r(s_t,a_t)\right]
$$

定义2（归一化目标，教材里最常用的那个紧凑形式就是从这来的）：

$$
J(\theta)=(1-\gamma)\mathbb{E}_{\tau\sim p_\theta(\tau)}\left[\sum_{t=0}^{\infty}\gamma^t r(s_t,a_t)\right]
$$

轨迹分布：

$$
p_\theta(\tau)=p(s_0)\prod_{k=0}^{\infty}\pi_\theta(a_k|s_k)P(s_{k+1}|s_k,a_k)
$$

## 一、似然比引理——整个推导里唯一真正用到"求导"的地方

这个引理是整件事的核心工具。对任意可积函数 $F(\tau)$：

$$
\nabla_\theta \mathbb{E}_{\tau\sim p_\theta}[F(\tau)]
=\mathbb{E}_{\tau\sim p_\theta}\big[F(\tau)\cdot\nabla_\theta\log p_\theta(\tau)\big]
$$

乍一看有点魔法，但其实就是把期望里的积分号和求导号交换了一下，然后用 $\nabla \log f = \frac{\nabla f}{f}$ 这个恒等式。本质上是一个"对数导数技巧"。

对轨迹分布取对数梯度：

$$
\log p_\theta(\tau)=\log p(s_0)+\sum_{k=0}^\infty\log\pi_\theta(a_k|s_k)+\sum_{k=0}^\infty\log P(s_{k+1}|s_k,a_k)
$$

注意环境转移项 $P(s'|s,a)$ 不含参数 $\theta$，求导直接消失，干净利落：

$$
\nabla_\theta\log p_\theta(\tau)=\sum_{t=0}^{\infty}\nabla_\theta\log\pi_\theta(a_t|s_t)
$$

这一步其实已经揭示了策略梯度方法的一个本质特征：**你不需要知道环境模型**。转移概率在梯度里消失了，你只需要对策略本身求导。这也是为什么 policy gradient 是 model-free 方法。

## 二、开始求目标梯度（使用无归一目标 $J(\theta)$）

从原始目标出发：

$$
\nabla_\theta J(\theta)
=\nabla_\theta \mathbb{E}_{\tau\sim p_\theta}\left[\sum_{k=0}^{\infty}\gamma^k r(s_k,a_k)\right]
$$

套用似然比引理：

$$
\nabla_\theta J(\theta)
=\mathbb{E}_{\tau\sim p_\theta}\left[
\left(\sum_{k=0}^{\infty}\gamma^k r(s_k,a_k)\right)
\left(\sum_{t=0}^{\infty}\nabla_\theta\log\pi_\theta(a_t|s_t)\right)
\right]
$$

现在梯度里面有两坨求和：一坨是回报的折扣和，一坨是策略对数梯度的和。交换求和顺序：

$$
\nabla_\theta J(\theta)
=\sum_{t=0}^{\infty}\mathbb{E}_{\tau\sim p_\theta}\left[
\nabla_\theta\log\pi_\theta(a_t|s_t)\sum_{k=0}^{\infty}\gamma^k r(s_k,a_k)
\right]
$$

接下来是一个关键操作：把内层的 $\sum_{k=0}^\infty \gamma^k r_k$ 拆成"时刻 $t$ 之后"和"时刻 $t$ 之前"两段：

$$
\sum_{k=0}^\infty\gamma^k r(s_k,a_k)
=\gamma^t\sum_{k=t}^{\infty}\gamma^{k-t}r(s_k,a_k)+\sum_{k=0}^{t-1}\gamma^k r(s_k,a_k)
=\gamma^t G_t + \sum_{k=0}^{t-1}\gamma^k r(s_k,a_k)
$$

代入期望：

$$
\begin{aligned}
\nabla_\theta J(\theta)
&=\sum_{t=0}^\infty\mathbb{E}_{\tau}\Big[\nabla_\theta\log\pi_\theta(a_t|s_t)\cdot \gamma^t G_t\Big]\\
&\quad+\sum_{t=0}^\infty\mathbb{E}_{\tau}\Big[\nabla_\theta\log\pi_\theta(a_t|s_t)\sum_{k=0}^{t-1}\gamma^k r(s_k,a_k)\Big]
\end{aligned}
$$

**交叉项等于零**，这是整个推导里最容易让人"嗯？"一下的地方。理由是：

$\nabla_\theta\log\pi_\theta(a_t|s_t)$ 只依赖 $(s_t,a_t)$，而 $\sum_{k=0}^{t-1}\gamma^k r(s_k,a_k)$ 只依赖 $t$ 时刻之前的轨迹。给定 $s_t$ 的条件下，这两者是条件独立的——过去已经发生了，不会因为你将来在 $s_t$ 处用什么策略而改变。所以交叉期望拆成条件期望的乘积，其中一项的期望为零（对数概率梯度的期望恒为零），整个交叉项就消掉了。

于是得到策略梯度的中间形式：

$$
\boxed{
\nabla_\theta J(\theta)
=\sum_{t=0}^{\infty}\gamma^t\,\mathbb{E}_{\tau\sim p_\theta}\Big[\nabla_\theta\log\pi_\theta(a_t|s_t)\,G_t\Big]
}
$$

> ⚠️ 一个重要的心理标记：$\nabla_\theta$ 求导运算到这里**已经全部完成**。接下来所有操作只是纯代数重排、调换求和次序、封装分布——不再出现新的梯度运算。这个分界线如果不划清楚，后面看到 $P_\theta$ 被移来移去的时候很容易犯迷糊。

## 三、把轨迹期望转化成状态-动作期望

上面那个形式虽然正确，但期望是对整条轨迹取的，不方便做理论分析。我们想要一个在状态-动作空间上的期望。

引入动作价值函数：

$$
Q^{\pi_\theta}(s,a)\triangleq\mathbb{E}\big[G_t\,\big|\,s_t=s,a_t=a\big]
$$

对固定时刻 $t$：

$$
\mathbb{E}_{\tau}\Big[\nabla_\theta\log\pi_\theta(a_t|s_t)\,G_t\Big]
=\sum_{s,a} P_\theta(s_t=s)\,\pi_\theta(a|s)\cdot\nabla_\theta\log\pi_\theta(a|s)\,Q^{\pi_\theta}(s,a)
$$

代入梯度表达式：

$$
\nabla_\theta J(\theta)
=\sum_{t=0}^{\infty}\gamma^t
\sum_{s,a} P_\theta(s_t=s)\,\pi_\theta(a|s)\,\nabla_\theta\log\pi_\theta(a|s)\,Q^{\pi_\theta}(s,a)
$$

交换求和次序 $\sum_t\sum_{s,a}\rightarrow\sum_{s,a}\sum_t$——反正都是正项级数，随便换：

$$
\nabla_\theta J(\theta)
=\sum_{s,a}
\Big(\sum_{t=0}^{\infty}\gamma^t P_\theta(s_t=s)\Big)
\pi_\theta(a|s)\,\nabla_\theta\log\pi_\theta(a|s)\,Q^{\pi_\theta}(s,a)
$$

## 四、折扣状态访问分布——一个纯形式工具

到这里我们需要一个东西把 $\sum_t \gamma^t P_\theta(s_t=s)$ 包装成一个概率分布。定义：

$$
\rho^{\pi_\theta}(s)\triangleq (1-\gamma)\sum_{t=0}^{\infty}\gamma^t P_\theta(s_t=s)
$$

乘以 $(1-\gamma)$ 是为了让它归一化，变成一个合法的概率分布 $\sum_s \rho^{\pi_\theta}(s)=1$。没有这个系数的话，它是所有时间步带折扣权重的累加，不是一个分布。

于是：

$$
\sum_{t=0}^{\infty}\gamma^t P_\theta(s_t=s)=\frac{\rho^{\pi_\theta}(s)}{1-\gamma}
$$

再定义联合状态-动作访问分布：

$$
\mu^{\pi_\theta}(s,a)=\rho^{\pi_\theta}(s)\,\pi_\theta(a|s)
$$

代回梯度，无归一目标下的形式为：

$$
\nabla_\theta J(\theta)
=\frac{1}{1-\gamma}\sum_{s,a}\mu^{\pi_\theta}(s,a)\,\nabla_\theta\log\pi_\theta(a|s)\,Q^{\pi_\theta}(s,a)
$$

写成期望：

$$
\nabla_\theta J(\theta)
=\frac{1}{1-\gamma}\,\mathbb{E}_{(s,a)\sim\mu^{\pi_\theta}}
\Big[\nabla_\theta\log\pi_\theta(a|s)\,Q^{\pi_\theta}(s,a)\Big]
$$

## 五、归一化目标下的最简形式

如果你从一开始就采用带 $(1-\gamma)$ 归一的目标函数，两边同乘这个系数，$\frac{1}{1-\gamma}$ 就消掉了，得到教材里最常出现的那个干净版本：

$$
\boxed{
\nabla_\theta J(\theta)
=\mathbb{E}_{(s,a)\sim\mu^{\pi_\theta}}
\Big[\nabla_\theta\log\pi_\theta(a|s)\,Q^{\pi_\theta}(s,a)\Big]
}
$$

## 六、几个容易踩的坑

推导本身其实不长，但有几个地方特别容易让人想岔，我在这里标出来：

1. **"把 $P_\theta(s_t=s)$ 提到梯度外面"这件事根本没发生。** 梯度 $\nabla_\theta$ 在交换求和次序之前就已经算完了。后面所有的操作都是在处理一串已经定下来的实数级数，不涉及新的求导。这个次序很重要——要是反过来，先把 $\sum_t P_\theta$ 提出来再求导，结果就错了。

2. **$P_\theta(s_t=s)$ 不是"与 $\theta$ 无关"，只是简写。** 完整记法是 $P_\theta(s_t=s)$，它当然依赖策略参数——轨迹是 $\pi_\theta$ 生成的嘛。真正与 $\theta$ 无关的只有环境转移核 $P(s'|s,a)$。推导中写得简略不代表没有依赖。

3. **$\rho^{\pi_\theta}$ 不是马尔可夫链的平稳分布。** 它是人为构造的折扣加权访问分布，唯一目的就是把时间维度的求和封装进一个期望采样分布里，让最终的表达式变得紧凑。不要把平稳分布的概念套在这上面。

4. **紧凑单行形式只适用于无限时域理论证明。** REINFORCE、A2C 这些实际算法跑的是有限长度轨迹片段，代码里用的还是带 $\sum_{t=0}^T$ 的时间求和形式。单行期望在纸上是好看的，但不能直接翻译成代码。

---

写到这里基本就完了。策略梯度定理的推导本身不长，但中间那个"交叉项为零"的论证和 $P_\theta$ 能不能动的疑问，我第一次看的时候也卡了好一会儿。后来想明白了就发现其实就两件事：**似然比引理把求导变成对数梯度**，然后**因果性让过去和将来条件独立**。剩下的全是代数整理。

如果这篇对你也有帮助，那挺好。
