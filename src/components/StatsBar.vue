<script setup lang="ts">
interface Stats {
  total: number
  applied: number
  interviewing: number
  offer: number
}

defineProps<{ stats: Stats }>()

const cards = [
  { key: 'total', label: '总申请数' },
  { key: 'applied', label: '待回复' },
  { key: 'interviewing', label: '面试中' },
  { key: 'offer', label: '录取' },
] as const
</script>

<template>
  <section class="stats" aria-label="申请统计">
    <div v-for="card in cards" :key="card.key" class="stat-card">
      <span class="stat-value">{{ stats[card.key] }}</span>
      <span class="stat-label">{{ card.label }}</span>
    </div>
  </section>
</template>
