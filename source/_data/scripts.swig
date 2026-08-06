<script>
console.log("Light Pink Cyberpunk Background Loaded");

/* ============================================================
   全局参数（统一赛博粉蓝主题）
============================================================ */
const CYBER = {
  pink: "rgba(255,120,200,",
  blue: "rgba(0,150,255,",
  bg1: "rgba(255,240,250,0.95)",
  bg2: "rgba(230,245,255,0.95)",
  pulseSpeed: 3,
  particleCount: 160,
  repelRadius: 120
};

/* ============================================================
   1. 加载动画淡出
============================================================ */
window.addEventListener("load", () => {
  const loader = document.getElementById("gradient-loading");
  if (!loader) return;
  loader.style.opacity = "0";
  setTimeout(() => loader.style.display = "none", 600);
});

/* ============================================================
   2. 鼠标柔光（节流版）
============================================================ */
(() => {
  const light = document.getElementById("cursor-light");
  let mouseX = 0, mouseY = 0, ticking = false;

  document.addEventListener("mousemove", e => {
    mouseX = e.clientX - 90;
    mouseY = e.clientY - 90;

    if (!ticking) {
      ticking = true;
      requestAnimationFrame(() => {
        light.style.transform = `translate(${mouseX}px, ${mouseY}px)`;
        ticking = false;
      });
    }
  });
})();

/* ============================================================
   3. 粉色赛博流动背景（主背景）
============================================================ */
(() => {
  const canvas = document.getElementById("cyberwave");
  const ctx = canvas.getContext("2d");

  const resize = () => {
    canvas.width = innerWidth;
    canvas.height = innerHeight;
  };
  resize();
  addEventListener("resize", resize);

  let t = 0;

  function draw() {
    t += 0.004;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 背景渐变
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, CYBER.bg1);
    gradient.addColorStop(1, CYBER.bg2);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 多层流动光带
    const colors = [
      CYBER.pink + "0.25)",
      CYBER.blue + "0.22)",
      "rgba(255,150,230,0.18)"
    ];

    colors.forEach((color, i) => {
      ctx.beginPath();
      ctx.moveTo(0, canvas.height * (0.25 + i * 0.25));

      for (let x = 0; x < canvas.width; x++) {
        const y =
          Math.sin(x * 0.002 + t * (1 + i * 0.3)) * (18 + i * 6) +
          Math.cos(x * 0.004 + t * (2 + i * 0.5)) * (10 + i * 4) +
          canvas.height * (0.25 + i * 0.25);

        ctx.lineTo(x, y);
      }

      ctx.strokeStyle = color;
      ctx.lineWidth = 2.2;
      ctx.stroke();
    });

    // 粉色能量脉冲
    const pulse = Math.sin(t * CYBER.pulseSpeed) * 0.15 + 0.25;
    ctx.fillStyle = CYBER.pink + pulse + ")";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    requestAnimationFrame(draw);
  }

  draw();
})();

/* ============================================================
   4. 粉蓝柔光粒子（优化版）
============================================================ */
(() => {
  const canvas = document.getElementById("particle-canvas");
  const ctx = canvas.getContext("2d");

  const resize = () => {
    canvas.width = innerWidth;
    canvas.height = innerHeight;
  };
  resize();
  addEventListener("resize", resize);

  let particles = [];
  const mouse = { x: null, y: null };

  addEventListener("mousemove", e => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });

  function initParticles() {
    particles = [];
    for (let i = 0; i < CYBER.particleCount; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 40 + 10,
        vx: (Math.random() - 0.5) * 0.6,
        vy: (Math.random() - 0.5) * 0.6,
        alpha: Math.random() * 0.4 + 0.4,
        color: Math.random() > 0.5 ? CYBER.pink : CYBER.blue
      });
    }
  }

  function repel(p) {
    if (!mouse.x) return;
    const dx = p.x - mouse.x;
    const dy = p.y - mouse.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < CYBER.repelRadius) {
      const force = (CYBER.repelRadius - dist) / CYBER.repelRadius;
      const angle = Math.atan2(dy, dx);
      p.x += Math.cos(angle) * force * 6;
      p.y += Math.sin(angle) * force * 6;
    }
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    particles.forEach(p => {
      repel(p);

      p.x += p.vx;
      p.y += p.vy;

      if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
      if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color + p.alpha + ")";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    });

    requestAnimationFrame(draw);
  }

  initParticles();
  draw();
})();

/* ============================================================
   5. 跟随系统浅色模式
============================================================ */
(() => {
  const mq = matchMedia("(prefers-color-scheme: light)");
  const apply = e => {
    document.documentElement.dataset.theme = e.matches ? "light" : "dark";
  };
  apply(mq);
  mq.addEventListener("change", apply);
})();
</script>

<script>
/* ============================================================
   6. 粉色能量波滚动触发（增强版）
============================================================ */
(() => {
  const wave = document.getElementById("scroll-wave");
  let ticking = false;

  addEventListener("scroll", () => {
    if (!ticking) {
      ticking = true;

      wave.style.opacity = "1";
      wave.style.transform = `translateY(${scrollY * 0.15}px) scale(1.05)`;

      setTimeout(() => {
        wave.style.opacity = "0";
        ticking = false;
      }, 220);
    }
  });
})();
</script>

<script>
/* ============================================================
   7. 阅读进度条
============================================================ */
(() => {
  const bar = document.getElementById("reading-progress");
  let ticking = false;

  addEventListener("scroll", () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(() => {
        const scrollTop = scrollY;
        const docHeight = document.documentElement.scrollHeight - innerHeight;
        const progress = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
        bar.style.width = Math.min(progress, 100) + "%";
        ticking = false;
      });
    }
  });
})();

/* ============================================================
   8. 回到顶部按钮
============================================================ */
(() => {
  const btn = document.getElementById("back-to-top");
  let ticking = false;

  addEventListener("scroll", () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(() => {
        if (scrollY > 300) {
          btn.classList.add("visible");
        } else {
          btn.classList.remove("visible");
        }
        ticking = false;
      });
    }
  });

  btn.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
})();

/* ============================================================
   9. 图片灯箱
============================================================ */
(() => {
  const lightbox = document.getElementById("image-lightbox");
  const lightboxImg = lightbox.querySelector("img");

  document.addEventListener("click", e => {
    const img = e.target.closest(".post-body img");
    if (!img) return;

    lightboxImg.src = img.src;
    lightboxImg.alt = img.alt || "";
    lightbox.classList.add("active");
    document.body.style.overflow = "hidden";
  });

  lightbox.addEventListener("click", () => {
    lightbox.classList.remove("active");
    document.body.style.overflow = "";
  });

  addEventListener("keydown", e => {
    if (e.key === "Escape" && lightbox.classList.contains("active")) {
      lightbox.classList.remove("active");
      document.body.style.overflow = "";
    }
  });
})();

/* ============================================================
   10. TOC 目录滚动高亮 (IntersectionObserver)
============================================================ */
(() => {
  const tocLinks = document.querySelectorAll("#aside-content .toc-link");
  if (!tocLinks.length) return;

  const headings = [];
  document.querySelectorAll(".post-body h1, .post-body h2, .post-body h3").forEach(h => {
    if (h.id) headings.push(h);
  });
  if (!headings.length) return;

  const observer = new IntersectionObserver(entries => {
    let activeId = null;
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        activeId = entry.target.id;
      }
    });

    if (activeId) {
      tocLinks.forEach(link => {
        link.classList.remove("active");
        const href = link.getAttribute("href");
        if (href && href.slice(1) === activeId) {
          link.classList.add("active");
          link.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
      });
    }
  }, {
    rootMargin: "-80px 0px -60% 0px",
    threshold: 0
  });

  headings.forEach(h => observer.observe(h));
})();
</script>
