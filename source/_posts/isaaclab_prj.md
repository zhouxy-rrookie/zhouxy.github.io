---
title: IsaacLab入门级食用方法
mathjax: true
tags:
    - 足式机器人
    - 强化学习
    - 控制
    - 机器人
categories: 强化学习
cover: https://img.cdn1.vip/i/69b966ad97776_1773758125.webp
---



# Isaac Lab External 项目完整工作流

本教程面向已经配置好Isaaclab强化学习环境的新手玩家

项目仓库：https://github.com/Leggedsys/legged_train/tree/main

第一次新建一个空的IsaacLab外部项目，除了跑一跑倒立摆的示例，我也不知道下一步要做什么。仓库是新的，我的目标是训练一条机器狗，下一步要干啥？：先放URDF ？写 env ？先写 PPO 配置？还是去啃官方教程？本人想做一篇文档教程作为参考，把训练一台机器狗这个事，完整记录一下。

整个过程其实比较简单：先把项目变成一个能被IsaacLab 识别的Python扩展，再把机器人资产接进来，然后围绕这台机器人写配置、场景、环境和奖励，最后再接上PPO训练与回放脚本。难点从来不在于某一步特别神秘，我们第一次做isaaclab项目时，大概已经知道我要做的无非就这些事，但不知道从何开始，也不知道这些文件到底是干啥的。只要这条线理顺了，后面想加入平地gait、rough terrain、抗扰动或者sim-to-real 扩展，其实都会顺很多。

## 项目环境准备

我的项目一样的把资产、环境和脚本区分开。在本仓库里，`source/legged_sys/legged_sys/dog/` 负责机器人资产和机器人配置，`source/legged_sys/legged_sys/tasks/` 负责环境和任务，`scripts/` 负责训练、回放和验证脚本，`docs/` 负责文档。

第一步不是写环境，而是先让外部项目本身成为一个可安装的 Python 包，IsaacLab在生成外部项目时会自动生成一个`setup.py`。就是告诉 Python这个包叫{packages}，有哪些依赖，版本是多少，应该如何被安装。就可以用 `python -m pip install -e {path}` 来安装它。

## 加载你的机器人资产

项目安装之后，就可以加载机器人模型文件了。对四足机器人来说，资产是整个训练的物理基础。你可能有 URDF、MJCF，甚至直接有 USD，但IsaacLab真正训练时要用USD文件，所以我们维护的是URDF，再转换成 USD。本项目训练时真正使用的资产是 `source/legged_sys/legged_sys/dog/dog.usd`。

模型文件有了以后，还要写机器人配置，也就是 `robot_cfg.py`。这个文件非常关键，因为它负责把一个 USD 资产真正包装成IsaacLab可用的 `ArticulationCfg`。可以参考本项目的 `source/legged_sys/legged_sys/dog/robot_cfg.py`。里面有几个变量特别值得理解。首先是 `DOG_USD_PATH`，它定义训练时究竟加载哪个资产。然后是 `DEFAULT_JOINT_POSITIONS`，这决定了机器人 reset 后默认站姿长什么样。最后是 `DOG_ARTICULATION_CFG`，它把资产路径、初始位置、默认关节角、执行器刚度阻尼等都组织进一个统一配置里。关节名字都是在urdf模型文件中定义的，你的key必须与资产文件严格一致。

可以直接看一段最小版的 `robot_cfg.py` 是怎么写的：

```python
ROBOT_USD_PATH = Path(__file__).resolve().parent / "dog.usd"

DEFAULT_JOINT_POSITIONS = {
    "FL_hip_joint": 0.18,
    "FL_thigh_joint": -0.88,
    "FL_calf_joint": -1.22,
    "FR_hip_joint": -0.18,
    "FR_thigh_joint": -0.88,
    "FR_calf_joint": -1.22,
    "RL_hip_joint": 0.18,
    "RL_thigh_joint": -0.88,
    "RL_calf_joint": -1.22,
    "RR_hip_joint": -0.18,
    "RR_thigh_joint": -0.88,
    "RR_calf_joint": -1.22,
}

ROBOT_ARTICULATION_CFG = ArticulationCfg(
    prim_path="{ENV_REGEX_NS}/Robot",
    spawn=sim_utils.UsdFileCfg(usd_path=str(ROBOT_USD_PATH)),
    init_state=ArticulationCfg.InitialStateCfg(
        pos=(0.0, 0.0, 0.42),
        joint_pos=DEFAULT_JOINT_POSITIONS,
    ),
    actuators={
        "joints": ImplicitActuatorCfg(
            joint_names_expr=[".*_joint"],
            stiffness=2000.0,
            damping=65.0,
        )
    },
)
```

这段代码说明了，第一，机器人用哪个模型，是由 `usd_path` 决定的；第二，关节默认姿态是通过 joint 名字字典来指定的；第三，执行器刚度和阻尼会直接影响关节动作的“手感”。如果你觉得机器人太飘、太弹、或者关节动作太软，很多时候不是环境 reward 问题，而是 actuator 参数本身就不合适。

## 环境配置

机器人配置好之后下一步是任务配置，也就是 `env_cfg.py`。可以把它理解成训练任务的规则书：机器人跑在什么地形，动作维度，观测维度，各种reward的权重，终止条件，这些都应该在这个文件里定义。本仓库里这一层在 `source/legged_sys/legged_sys/tasks/direct/legged_sys/legged_sys_velocity_env_cfg.py`。

我们可以先把场景定义好。一个最基础的平地任务，SceneCfg 至少应该包含一个地面和一台机器人；如果需要其他的感知能力，还可能需要其他的传感器。本项目里，平地任务的 SceneCfg 和楼梯任务的 SceneCfg 分别叫 `LeggedSysVelocityFlatSceneCfg` 和 `LeggedSysVelocityRoughSceneCfg`。后者之所以更复杂，是因为它除了 terrain generator 之外，还挂了一个 `height_scanner`。这就导致楼梯任务加了 height scan 以后，网络输入维度变了，平地的checkpoint不能直接迁移。我们最后是通过“让平地任务也加同样的 height scan”来统一输入结构。

最小版的 `env_cfg.py` 大概可以像这样：

```python
@configclass
class FlatSceneCfg(InteractiveSceneCfg):
    terrain = TerrainImporterCfg(
        prim_path="/World/ground",
        terrain_type="plane",
        physics_material=sim_utils.RigidBodyMaterialCfg(static_friction=1.2, dynamic_friction=1.0),
        visual_material=sim_utils.PreviewSurfaceCfg(diffuse_color=(0.3, 0.3, 0.3)),
        debug_vis=False,
    )


@configclass
class MyVelocityEnvCfg(DirectRLEnvCfg):
    decimation = 2
    episode_length_s = 10.0
    action_space = 12
    observation_space = 48
    state_space = 0

    sim = sim_utils.SimulationCfg(dt=1 / 120, render_interval=decimation)
    scene = FlatSceneCfg(num_envs=1024, env_spacing=3.0, replicate_physics=True)

    robot_cfg = ROBOT_ARTICULATION_CFG.replace(
        prim_path="/World/envs/env_.*/Robot",
        spawn=ROBOT_ARTICULATION_CFG.spawn.replace(activate_contact_sensors=True),
    )
    contact_sensor = ContactSensorCfg(
        prim_path="/World/envs/env_.*/Robot/.*",
        history_length=3,
        update_period=0.005,
        track_air_time=True,
    )

    action_scale = 0.1
    command_x_range = (0.3, 1.0)
    command_y_range = (0.0, 0.0)
    command_yaw_range = (0.0, 0.0)

    track_lin_vel_reward_scale = 5.0
    track_ang_vel_reward_scale = 2.0
    feet_slip_reward_scale = -0.2
```

这段配置已经足够让一个简单平地速度任务跑起来。它先定义了动作、观测和 episode 基本长度，再定义场景和机器人，再给一些最基础的 reward 项。外部项目从零开始时，不要一上来就在这里塞几十个 reward 项，先让一版最小任务能稳定跑起来，后面再逐渐往里面加 gait、step length、hip symmetry、height scan、adaptive clearance 这些更细的东西。

真正让任务动起来的，是 `env.py`。这个文件是 external 项目里最核心的逻辑层。很多人听到“环境实现”会觉得很难，但如果拆开看，它其实就是固定几个函数。你在本项目的 `source/legged_sys/legged_sys/tasks/direct/legged_sys/legged_sys_velocity_env.py` 里能看到一整套成熟实现。一个最小可训练环境，至少应该把 `_setup_scene()`、`_pre_physics_step()`、`_apply_action()`、`_get_observations()`、`_get_rewards()`、`_get_dones()` 和 `_reset_idx()` 这些函数写完整。

下面这段最小骨架，理解这些函数该怎么写：

```python

class MyVelocityEnv(DirectRLEnv):
    cfg: MyVelocityEnvCfg

    def __init__(self, cfg: MyVelocityEnvCfg, render_mode=None, **kwargs):
        super().__init__(cfg, render_mode, **kwargs)
        self._actions = torch.zeros(self.num_envs, self.cfg.action_space, device=self.device)
        self._commands = torch.zeros(self.num_envs, 3, device=self.device)
        self._joint_pos_target = self.robot.data.default_joint_pos.clone()

    def _setup_scene(self):
        self.robot = Articulation(self.cfg.robot_cfg)
        self._contact_sensor = ContactSensor(self.cfg.contact_sensor)
        self.scene.clone_environments(copy_from_source=False)
        self.scene.articulations["robot"] = self.robot
        self.scene.sensors["contact_sensor"] = self._contact_sensor

    def _pre_physics_step(self, actions: torch.Tensor):
        self._actions.copy_(actions)
        self._joint_pos_target = self.robot.data.default_joint_pos + self.cfg.action_scale * self._actions

    def _apply_action(self):
        self.robot.set_joint_position_target(self._joint_pos_target)

    def _get_observations(self):
        joint_pos_error = self.robot.data.joint_pos - self.robot.data.default_joint_pos
        obs = torch.cat(
            [
                self.robot.data.root_lin_vel_b,
                self.robot.data.root_ang_vel_b,
                self.robot.data.projected_gravity_b,
                self._commands,
                joint_pos_error,
                self.robot.data.joint_vel,
                self._actions,
            ],
            dim=-1,
        )
        return {"policy": obs}

    def _get_rewards(self):
        lin_vel_error = torch.sum(torch.square(self._commands[:, :2] - self.robot.data.root_lin_vel_b[:, :2]), dim=1)
        reward = self.cfg.track_lin_vel_reward_scale * torch.exp(-lin_vel_error / 0.25)
        return reward

    def _get_dones(self):
        time_out = self.episode_length_buf >= self.max_episode_length - 1
        base_height = self.robot.data.root_pos_w[:, 2]
        died = base_height < 0.08
        return died, time_out

    def _reset_idx(self, env_ids):
        if env_ids is None:
            env_ids = self.robot._ALL_INDICES
        self.robot.reset(env_ids)
        super()._reset_idx(env_ids)
        self._commands[env_ids, 0] = sample_uniform(0.3, 1.0, (env_ids.numel(),), self.device)
        self._commands[env_ids, 1:] = 0.0
```

这段代码已经足够说明几个最重要的实现思想。`_setup_scene()` 的职责是把场景里的物体真正创建出来并注册进 scene；`_pre_physics_step()` 把策略动作转成环境内部的控制目标；`_apply_action()` 负责把关节目标真正交给机器人；`_get_observations()` 决定策略每一步看到什么；`_get_rewards()` 决定什么行为会被鼓励；`_get_dones()` 决定什么时候 episode 结束；`_reset_idx()` 决定 reset 后机器人从什么状态重新开始。理解了这条链，external 项目里的 env 实现就不再神秘。

“关节到底怎么运动起来”这个问题，本质上可以拆成三层。第一层是资产层，也就是 URDF/USD 里关节名字、关节轴和父子 link 关系的定义；第二层是 `robot_cfg.py` 里的 actuator 参数，决定目标关节角是用多大的刚度和阻尼来跟踪；第三层就是 `env.py` 里的动作映射逻辑。你在本项目当前环境里会看到一种典型写法：策略输出 12 维动作，先乘上 `action_scale`，再加到默认关节角上，形成 `self._joint_pos_target`，最后通过 `self.robot.set_joint_position_target(self._joint_pos_target)` 把它真正写给关节控制器。这就是“如何设置关节运动”的核心。你如果觉得关节不够灵活，通常会先调 `action_scale`；如果觉得动作太软太弹，则要去调 actuator 的 `stiffness` 和 `damping`；如果觉得某条腿方向不对，则往往要回头检查资产里的关节轴和默认姿态。

环境写好后，训练算法配置就是最后一层。对于 `rsl_rl`，你通常需要一个单独的 PPO 配置文件，例如本项目里的 `source/legged_sys/legged_sys/tasks/direct/legged_sys/agents/rsl_rl_velocity_ppo_cfg.py`。这个文件定义网络结构、学习率、entropy 系数、rollout 长度等。如果你想从零做一个 external 项目，建议前期先用中规中矩的 PPO 配置，不要一开始就疯狂改学习率或者 clip 参数。大多数早期训练问题其实不是 PPO 本身，而是环境定义和 reward 还没稳定。

你把环境和 PPO 配置都准备好后，还必须做一件常被忽略的事：任务注册。否则 `gym.make()` 根本找不到你的环境。本项目里可以直接参考 `source/legged_sys/legged_sys/tasks/direct/legged_sys/__init__.py`。一个最小注册例子长这样：

```python
import gymnasium as gym

from . import agents

gym.register(
    id="MyRobot-Velocity-Direct-v0",
    entry_point="my_robot_ext.tasks.direct.my_robot.my_env:MyVelocityEnv",
    disable_env_checker=True,
    kwargs={
        "env_cfg_entry_point": "my_robot_ext.tasks.direct.my_robot.my_env_cfg:MyVelocityEnvCfg",
        "rsl_rl_cfg_entry_point": "my_robot_ext.tasks.direct.my_robot.agents.rsl_rl_ppo_cfg:PPORunnerCfg",
    },
)
```

注册完成之后，就可以真正可以开始训练：

```bash
/root/IsaacLab/isaaclab.sh -p scripts/rsl_rl/train.py --task MyRobot-Velocity-Direct-v0
```

回放是：

```bash
/root/IsaacLab/isaaclab.sh -p scripts/rsl_rl/play.py \
  --task MyRobot-Velocity-Direct-v0 \
  --checkpoint "logs/rsl_rl/my_run/model_800.pt"
```

继续训练某个 checkpoint 时，核心参数则是：

```bash
--resume --load_run <run_name> --checkpoint <model_xxx.pt>
```

例如：

```bash
/root/IsaacLab/isaaclab.sh -p scripts/rsl_rl/train.py \
  --task Template-LeggedSys-Velocity-Rough-Direct-v0 \
  --resume \
  --load_run flat-unified-obs-1200-20260315_234416 \
  --checkpoint model_800.pt
```

但这里有个问题：checkpoint 不是只要文件在就能用。如果平地任务 observation 是 `48` 维，而楼梯任务 observation 是 `165` 维，那么旧 checkpoint 会直接报 `size mismatch`。这也是为什么我专门把平地任务和楼梯任务统一成同样的 observation 结构。这个经验非常值得在新项目里吸收：如果后面计划把一个任务里学到的策略迁移到另一个任务，就要从一开始考虑观测维度、动作维度和网络输入结构的兼容性。


