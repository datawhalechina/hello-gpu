---
layout: hg
title: 世界地图
description: 新手村、铸造城、试炼场的全部关卡：推荐等级、你的进度，还有你现在走到了哪一关。
---

<script setup>
import WorldMap from '../.vitepress/theme/v2/WorldMap.vue'
import { LEGACY_BY_STAGE } from '../course/v1.ts'
</script>

# 世界地图

<WorldMap :legacy="LEGACY_BY_STAGE" />
