<script setup lang="ts">
import ResourcesSettingsPanel from './ResourcesSettingsPanel.vue'
import StorageSettingsPanel from './StorageSettingsPanel.vue'
</script>

<template>
  <section class="flex flex-col gap-8 text-ink" aria-label="Workspace settings">
    <ResourcesSettingsPanel />
    <StorageSettingsPanel />
  </section>
</template>
