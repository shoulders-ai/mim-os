<template>
  <svg
    class="pointer-events-none absolute left-1/2 top-1/2 block h-[calc(100%_+_4px)] w-[calc(100%_+_4px)] -translate-x-1/2 -translate-y-1/2 overflow-visible"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <rect class="ring-arc" x="0.5" y="0.5" width="23" height="23" rx="7" ry="7" pathLength="100" />
  </svg>
</template>

<style scoped>
.ring-arc {
  fill: none;
  stroke: var(--color-accent);
  stroke-width: 1;
  stroke-linecap: round;
  stroke-dasharray: 30 70;
  opacity: 0.85;
  vector-effect: non-scaling-stroke;
  animation: working-icon-sweep 1.4s linear infinite;
}

@keyframes working-icon-sweep { to { stroke-dashoffset: -100; } }
</style>
