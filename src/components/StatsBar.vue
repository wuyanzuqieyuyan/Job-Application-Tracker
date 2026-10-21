<script setup lang="ts">
import { useI18n } from '../composables/useI18n'

interface Stats {
  total: number
  applied: number
  interviewing: number
  offer: number
}

defineProps<{ stats: Stats }>()

const { t } = useI18n()

const cards = [
  { key: 'total', label: 'statTotal' },
  { key: 'applied', label: 'statApplied' },
  { key: 'interviewing', label: 'statInterviewing' },
  { key: 'offer', label: 'statOffer' },
] as const
</script>

<template>
  <section class="stats" :aria-label="t('statsLabel')">
    <div v-for="card in cards" :key="card.key" class="stat-card">
      <span class="stat-value">{{ stats[card.key] }}</span>
      <span class="stat-label">{{ t(card.label) }}</span>
    </div>
  </section>
</template>
