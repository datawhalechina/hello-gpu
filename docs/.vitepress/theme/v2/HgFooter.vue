<script setup lang="ts">
/**
 * 新版页面页脚（F-06）：项目链接、旧版教程入口、隐私说明。
 * 备案号和许可协议沿用旧版页脚（docs/.vitepress/config.mts 的 themeConfig.footer），
 * 上线切换（M-02）后新版页面就是全站页面，这两条要一直在。
 */
import { withBase } from 'vitepress'

const REPO = 'https://github.com/datawhalechina/hello-gpu'
</script>

<template>
  <footer class="hg-footer">
    <div class="hg-footer__inner">
      <p class="hg-footer__privacy">进度只存在你的浏览器里</p>

      <nav class="hg-footer__links" aria-label="站点信息">
        <a class="hg-footer__link" :href="withBase('/v1/')">旧版教程</a>
        <a class="hg-footer__link" :href="REPO" target="_blank" rel="noreferrer">
          GitHub 仓库
          <svg class="hg-footer__out" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
            stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M13 5h6v6M19 5l-9 9M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
          </svg>
        </a>
        <a class="hg-footer__link" :href="`${REPO}/issues`" target="_blank" rel="noreferrer">
          反馈问题
          <svg class="hg-footer__out" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
            stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M13 5h6v6M19 5l-9 9M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
          </svg>
        </a>
      </nav>

      <p class="hg-footer__legal">
        本作品采用
        <a href="http://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noreferrer">CC BY-NC-SA 4.0</a>
        许可
        <span class="hg-footer__sep" aria-hidden="true">·</span>
        <a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">京ICP备2026002630号-1</a>
        <span class="hg-footer__sep" aria-hidden="true">·</span>
        <a href="https://beian.mps.gov.cn/#/query/webSearch?code=11010602202215" target="_blank" rel="noreferrer">京公网安备11010602202215号</a>
      </p>
    </div>
  </footer>
</template>

<style scoped>
.hg-footer {
  margin-top: auto;
  border-top: var(--hg-border-width) solid var(--hg-border);
  background: var(--hg-surface);
}

.hg-footer__inner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 20px;
  max-width: var(--hg-shell-max);
  margin: 0 auto;
  padding: 24px;
}

.hg-footer__privacy {
  margin: 0;
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  letter-spacing: var(--hg-tracking-eyebrow);
  color: var(--hg-accent-ink);
}

.hg-footer__links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  margin-left: auto;
}

.hg-footer__link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 14px;
  color: var(--hg-ink-2);
  text-decoration: none;
}

.hg-footer__link:hover {
  color: var(--hg-ink);
}

.hg-footer__out {
  flex: none;
  color: var(--hg-ink-3);
}

.hg-footer__legal {
  flex: 1 0 100%;
  margin: 0;
  font-size: 13px;
  color: var(--hg-ink-3);
}

.hg-footer__legal a {
  color: inherit;
}

.hg-footer__sep {
  margin: 0 6px;
}

.hg-footer__link:focus-visible,
.hg-footer__legal a:focus-visible {
  outline: 2px solid var(--hg-accent);
  outline-offset: 2px;
}

@media (max-width: 767px) {
  .hg-footer__inner {
    padding: 20px 16px 28px;
  }

  .hg-footer__links {
    margin-left: 0;
  }
}
</style>
