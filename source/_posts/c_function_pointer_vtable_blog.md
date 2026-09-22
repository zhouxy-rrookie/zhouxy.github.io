---
title: 用函数指针在 C 里模拟虚函数表
mathjax: true
tags: 
    - 嵌入式
    - C语言
    - 机器人
cover: https://img.cdn1.vip/i/69b967e9d0aa8_1773758441.webp
categories: 嵌入式
---

# C语言中的函数指针与虚函数表模拟

在C语言模拟面向对象的技巧里，**函数指针**和**虚函数表风格的操作表**，是最核心的一层机制。当系统开始管理越来越多的设备、模块和控制逻辑时，单纯依靠一堆分散的函数和条件分支，代码会越来越难维护。

在嵌入式系统中，如何用 C 语言的函数指针模拟“对象方法”，再进一步模拟“虚函数表”和“多态调用”？


---

# 一、为什么普通 C 写法会越来越难维护

先看最朴素的写法。假设我们有两类电机：

- DJI 电机
- DM 电机

一开始也许只需要做“使能”：

```c
if (motor_type == DJI_MOTOR) {
    dji_motor_enable();
} else if (motor_type == DM_MOTOR) {
    dm_motor_enable();
}
```

后来需求变多了，还要设置目标值、解析反馈、执行控制更新：

```c
if (motor_type == DJI_MOTOR) {
    dji_motor_enable();
    dji_motor_set_ref(ref);
    dji_motor_decode_feedback(rx_data);
    dji_motor_control_update();
} else if (motor_type == DM_MOTOR) {
    dm_motor_enable();
    dm_motor_set_ref(ref);
    dm_motor_decode_feedback(rx_data);
    dm_motor_control_update();
}
```

刚开始看起来没什么问题，但随着项目扩大，问题会越来越明显：

1. **分支越来越多**  
   每增加一种设备，就会多出一串 `if-else` 或 `switch-case`。

2. **上层知道太多底层细节**  
   控制层本来只想“让电机工作”，结果却必须知道“这是哪一种电机、用什么协议、反馈格式是什么”。

3. **扩展成本高**  
   新增一种设备时，不只是加新代码，还要修改很多旧代码。

4. **模块耦合严重**  
   应用层直接依赖具体驱动函数，导致系统边界模糊。

这就是把嵌入式项目做成“对象化组织”的原因。系统复杂后，我们需要一种办法把数据和行为绑定起来，并为上层提供统一接口。

---

# 二、函数指针：在 C 中绑定“数据”和“行为”

C 语言没有类，没有成员函数，但它有一个非常强大的机制：函数指针。
函数指针的本质就是一个变量里保存了函数的地址，我们可以把这个数据应该调用什么函数也一起存起来。

先看一个最简单的例子：

```c
#include <stdio.h>

void say_hello(void) {
    printf("hello\n");
}

int main(void) {
    void (*func)(void) = say_hello;
    func();
    return 0;
}
```

这里的 `func` 就是一个函数指针。  
它指向 `say_hello`，所以 `func()` 实际上等价于调用 `say_hello()`。

把这个思路进一步扩展，就可以在结构体中保存函数指针，让结构体既表示“状态”，也知道“该怎么做事”。

例如：

```c
typedef struct Motor Motor;

typedef struct {
    void (*enable)(Motor *self);
    void (*disable)(Motor *self);
    void (*set_ref)(Motor *self, float ref);
} MotorOps;

struct Motor {
    const MotorOps *ops;
    float ref;
    float speed;
    float position;
};
```

这里已经有一点对象的感觉了：

- `Motor` 保存数据
- `MotorOps` 保存行为接口
- `ops` 把数据和行为关联起来

调用时就可以写成：

```c
motor->ops->enable(motor);
motor->ops->set_ref(motor, 10.0f);
```

---

# 三、方法调用

函数签名里要手动传一个指针
例如：
```c
void motor_enable(Motor *self);
void motor_set_ref(Motor *self, float ref);
``` 
在 C++ 里，成员函数调用时会隐式传入 `this` 指针；  但在 C 里没有这个机制，所以我们只能显式传入 `self`。

# 四、虚函数表是什么，它和普通函数指针有什么区别

## 1. 结构体里直接保存多个函数指针

例如：

```c
typedef struct {
    void (*enable)(void *self);
    void (*disable)(void *self);
    void (*set_ref)(void *self, float ref);
} Motor;
```

这种写法很直接，但有个明显问题：每个实例都保存一整套函数指针，如果实例很多，会浪费 RAM，这种写法不够优雅。

## 2. 把函数指针集中成一张“操作表”

更常见的方式是：

```c
typedef struct {
    void (*enable)(void *self);
    void (*disable)(void *self);
    void (*set_ref)(void *self, float ref);
    void (*decode_feedback)(void *self, const unsigned char *data);
} MotorVTable;
```

然后对象里只保存一个指针：

```c
typedef struct {
    const MotorVTable *vptr;
    float ref;
    float speed;
    float pos;
} MotorBase;
```

这样，同类对象就可以共享一张操作表。

例如所有 DJI 电机对象都共用 `dji_motor_vtable`，  
所有 DM 电机对象都共用 `dm_motor_vtable`。



# 五、为什么“虚函数表风格”更适合嵌入式

这种写法在机器人嵌入式系统中特别有价值，主要有几个原因。

1. 节省内存
如果同类对象共用一张操作表，那么每个对象只需要保存一个 `vptr` 指针。  

2. 接口统一

控制器只关心：使能、失能、设置目标这些方法，并不关心底层是什么，这样控制器可以面向一个抽象接口编程

3. 扩展容易
新增一种电机时，只需要定义一种新结构体，再实现一组专用函数
配一张新的操作表即可，原来的控制逻辑基本不用改。

1. 更适合团队协作

驱动层、控制层、任务层都可以围绕统一接口协作。  
模块边界更清晰，职责更明确。

---

# 六、如何在 C 中模拟“继承”

“继承”是另一个很常被提到的词。  
当然，C 语言并没有真正的继承机制，但我们可以通过**结构体嵌套**来模拟。

最典型的写法就是把“基类”放在结构体的第一个成员位置：

```c
typedef struct {
    const MotorVTable *vptr;
    float ref;
    float speed;
    float position;
} MotorBase;

typedef struct {
    MotorBase base;
    unsigned short ecd;
    short rpm;
    short torque;
} DJIMotor;

typedef struct {
    MotorBase base;
    unsigned char id;
    float q;
    float dq;
} DMMotor;
```

这样做的关键在于内存布局：

- `DJIMotor` 的起始地址与 `DJIMotor.base` 的地址相同
- `DMMotor` 的起始地址与 `DMMotor.base` 的地址也相同

因此可以把子类对象安全地“当作”父类对象来使用：

```c
DJIMotor dji;
MotorBase *motor = (MotorBase *)&dji;
```

这样上层统一处理 `MotorBase *`，而底层仍然可以根据具体类型执行不同实现。

要注意，这不是语言级的继承，而是一种**工程约定**。  
它成立的基础是：

1. 父结构体放在第一个成员位置  
2. 所有接口都遵守同样的约定  
3. 类型转换清晰且可控  

这类技巧在嵌入式和内核代码里非常常见。

---

# 七、如何模拟“重写”和“多态”

当我们有了：

- 基类结构体 `MotorBase`
- 操作表 `MotorVTable`
- 多种具体实现 `DJIMotor` / `DMMotor`

接下来就自然会出现“重写”和“多态”。

## 1. “重写”是什么

同一个接口，不同实现。

例如，所有电机都要支持反馈解析：

```c
void dji_decode_feedback(void *self, const unsigned char *data);
void dm_decode_feedback(void *self, const unsigned char *data);
```

它们对上层来说接口一致，但内部实现完全不同。

这就是“重写”的本质。

## 2. “多态”是什么

所谓多态，不是说“一个东西能做很多事”，  
而是说：

> 调用方式统一，但具体执行哪个实现，由对象实际类型决定。

例如：

```c
motor->vptr->decode_feedback(motor, rx_data);
```

对于 `DJIMotor`，这会调用 `dji_decode_feedback`；  
对于 `DMMotor`，这会调用 `dm_decode_feedback`。

上层完全不需要写：

```c
if (type == DJI) ...
else if (type == DM) ...
```

这就是多态带来的最大价值：**消除分支，把变化封装到底层实现中。**

---

# 八、一个完整的小案例：统一电机接口设计

下面给出一个简化版的完整案例，说明如何在 C 中实现“虚函数表风格的统一电机接口”。

## 1. 定义操作表和基类

```c
#include <stdio.h>

typedef struct MotorBase MotorBase;

typedef struct {
    void (*enable)(MotorBase *self);
    void (*disable)(MotorBase *self);
    void (*set_ref)(MotorBase *self, float ref);
    void (*print_status)(MotorBase *self);
} MotorVTable;

struct MotorBase {
    const MotorVTable *vptr;
    float ref;
    float speed;
};
```

## 2. 定义两种具体电机

```c
typedef struct {
    MotorBase base;
    int can_id;
    int ecd;
} DJIMotor;

typedef struct {
    MotorBase base;
    int node_id;
    float torque;
} DMMotor;
```

## 3. 实现 DJI 电机行为

```c
void dji_enable(MotorBase *self) {
    DJIMotor *motor = (DJIMotor *)self;
    printf("[DJI] enable, can_id=%d\n", motor->can_id);
}

void dji_disable(MotorBase *self) {
    DJIMotor *motor = (DJIMotor *)self;
    printf("[DJI] disable, can_id=%d\n", motor->can_id);
}

void dji_set_ref(MotorBase *self, float ref) {
    self->ref = ref;
    printf("[DJI] set ref = %.2f\n", ref);
}

void dji_print_status(MotorBase *self) {
    DJIMotor *motor = (DJIMotor *)self;
    printf("[DJI] can_id=%d, ref=%.2f, speed=%.2f\n",
           motor->can_id, self->ref, self->speed);
}
```

## 4. 实现 DM 电机行为

```c
void dm_enable(MotorBase *self) {
    DMMotor *motor = (DMMotor *)self;
    printf("[DM] enable, node_id=%d\n", motor->node_id);
}

void dm_disable(MotorBase *self) {
    DMMotor *motor = (DMMotor *)self;
    printf("[DM] disable, node_id=%d\n", motor->node_id);
}

void dm_set_ref(MotorBase *self, float ref) {
    self->ref = ref;
    printf("[DM] set ref = %.2f\n", ref);
}

void dm_print_status(MotorBase *self) {
    DMMotor *motor = (DMMotor *)self;
    printf("[DM] node_id=%d, ref=%.2f, speed=%.2f\n",
           motor->node_id, self->ref, self->speed);
}
```

## 5. 定义两张虚函数表

```c
const MotorVTable dji_vtable = {
    .enable = dji_enable,
    .disable = dji_disable,
    .set_ref = dji_set_ref,
    .print_status = dji_print_status,
};

const MotorVTable dm_vtable = {
    .enable = dm_enable,
    .disable = dm_disable,
    .set_ref = dm_set_ref,
    .print_status = dm_print_status,
};
```

## 6. 初始化对象

```c
void dji_motor_init(DJIMotor *motor, int can_id) {
    motor->base.vptr = &dji_vtable;
    motor->base.ref = 0.0f;
    motor->base.speed = 0.0f;
    motor->can_id = can_id;
    motor->ecd = 0;
}

void dm_motor_init(DMMotor *motor, int node_id) {
    motor->base.vptr = &dm_vtable;
    motor->base.ref = 0.0f;
    motor->base.speed = 0.0f;
    motor->node_id = node_id;
    motor->torque = 0.0f;
}
```

## 7. 上层统一调用

```c
int main(void) {
    DJIMotor dji;
    DMMotor dm;

    dji_motor_init(&dji, 0x201);
    dm_motor_init(&dm, 1);

    MotorBase *motors[2];
    motors[0] = (MotorBase *)&dji;
    motors[1] = (MotorBase *)&dm;

    for (int i = 0; i < 2; ++i) {
        motors[i]->vptr->enable(motors[i]);
        motors[i]->vptr->set_ref(motors[i], 10.0f + i);
        motors[i]->vptr->print_status(motors[i]);
    }

    return 0;
}
```

从这个例子可以看到，上层逻辑已经不需要关心“这到底是 DJI 还是 DM”。  
它只知道：这是一个“满足统一接口的电机对象”。

这就是 C 语言模拟虚函数表的核心价值。

---


# 九、什么时候该用，什么时候不该用

这部分可以作为很实用的经验总结。

## 适合使用的场景

- 设备种类多，接口行为相似
- 上层逻辑希望统一调用方式
- 模块边界明确，需要长期扩展
- 团队协作开发，需要减少耦合
- 项目会持续演进，不是一次性代码

## 不太适合使用的场景

- 系统非常小，设备类型单一
- 项目生命周期短，快速交付优先
- 团队成员对这种设计风格不熟悉
- 抽象层次已经多到影响可读性

一句话总结就是：

> **复杂系统适合抽象，简单系统适合直接。**

---


