<template>
  <span
    class="inline-grid grid-cols-[repeat(3,3px)] grid-rows-[repeat(3,3px)] gap-[2px] shrink-0"
    aria-label="Working"
  >
    <span v-for="n in 9" :key="n" class="w-[3px] h-[3px] rounded-full bg-accent will-change-[opacity]" />
  </span>
</template>

<style scoped>
span > span:nth-child(1) { animation: m1 5s ease-in-out infinite; }
span > span:nth-child(2) { animation: m2 5s ease-in-out infinite; }
span > span:nth-child(3) { animation: m3 5s ease-in-out infinite; }
span > span:nth-child(4) { animation: m4 5s ease-in-out infinite; }
span > span:nth-child(5) { animation: m5 5s ease-in-out infinite; }
span > span:nth-child(6) { animation: m6 5s ease-in-out infinite; }
span > span:nth-child(7) { animation: m7 5s ease-in-out infinite; }
span > span:nth-child(8) { animation: m8 5s ease-in-out infinite; }
span > span:nth-child(9) { animation: m9 5s ease-in-out infinite; }

/*
  The long loop — 5s, 3 movements, OPACITY ONLY.
  Verified in WorkingIndicator.compare.html. No transform (can't grow/shrink),
  no box-shadow (no glow). Every dot stays a fixed 3px; motion is brightness only.

  Grid:   1 2 3        Ring (clockwise): 1 -> 2 -> 3 -> 6 -> 9 -> 8 -> 7 -> 4
          4 5 6        Opacity: base .2, trail .5, peak 1.0. Center = 5.
          7 8 9

  Movement A (0–36%)   Twin orbit — two dots chase 180° apart (the original's
                       signature). Center breathes once. Lands on {1,9}.
  Movement B (36–68%)  Comet — one bright dot + soft dimming trail laps the ring.
  Movement C (68–100%) Twin comet — two comets chase 180° apart, more energy,
                       lands back on {1,9} so the loop is seamless.

  Dot 1 lights at every movement change (0s / 1.8s / 3.4s) — the heartbeat that
  ties the three movements together. All keyframes share 0%==100% so the loop
  has no seam. 2× the original compare-page speed (10s -> 5s).
*/

@keyframes m1 {
  0%, 100% { opacity: 1; }
  4%       { opacity: .5; }
  12%      { opacity: .2; }
  28%      { opacity: .2; }
  32%      { opacity: .5; }
  36%      { opacity: 1; }
  40%      { opacity: .5; }
  48%      { opacity: .2; }
  60%      { opacity: .2; }
  64%      { opacity: .5; }
  68%      { opacity: 1; }
  72%      { opacity: .5; }
  80%      { opacity: .2; }
  92%      { opacity: .2; }
  96%      { opacity: .5; }
}

@keyframes m2 {
  0%, 100% { opacity: .2; }
  5%       { opacity: .5; }
  9%       { opacity: 1; }
  13%      { opacity: .5; }
  20%      { opacity: .2; }
  36%      { opacity: .5; }
  40%      { opacity: 1; }
  44%      { opacity: .5; }
  52%      { opacity: .2; }
  72%      { opacity: .5; }
  76%      { opacity: 1; }
  80%      { opacity: .5; }
  88%      { opacity: .2; }
}

@keyframes m3 {
  0%, 100% { opacity: .2; }
  14%      { opacity: .5; }
  18%      { opacity: 1; }
  22%      { opacity: .5; }
  30%      { opacity: .2; }
  40%      { opacity: .5; }
  44%      { opacity: 1; }
  48%      { opacity: .5; }
  56%      { opacity: .2; }
  80%      { opacity: .5; }
  84%      { opacity: 1; }
  88%      { opacity: .5; }
  94%      { opacity: .2; }
}

@keyframes m4 {
  0%, 100% { opacity: .2; }
  23%      { opacity: .5; }
  27%      { opacity: 1; }
  31%      { opacity: .5; }
  38%      { opacity: .2; }
  60%      { opacity: .5; }
  64%      { opacity: 1; }
  68%      { opacity: .5; }
  76%      { opacity: .2; }
  88%      { opacity: .5; }
  92%      { opacity: 1; }
  96%      { opacity: .5; }
}

@keyframes m5 {
  0%, 100% { opacity: .22; }
  14%      { opacity: .5; }
  18%      { opacity: .6; }
  22%      { opacity: .5; }
  30%      { opacity: .22; }
  36%      { opacity: .3; }
  40%      { opacity: .2; }
  64%      { opacity: .2; }
  68%      { opacity: .3; }
  72%      { opacity: .2; }
  92%      { opacity: .2; }
  96%      { opacity: .3; }
}

@keyframes m6 {
  0%, 100% { opacity: .2; }
  23%      { opacity: .5; }
  27%      { opacity: 1; }
  31%      { opacity: .5; }
  38%      { opacity: .2; }
  44%      { opacity: .5; }
  48%      { opacity: 1; }
  52%      { opacity: .5; }
  60%      { opacity: .2; }
  88%      { opacity: .5; }
  92%      { opacity: 1; }
  96%      { opacity: .5; }
}

@keyframes m7 {
  0%, 100% { opacity: .2; }
  14%      { opacity: .5; }
  18%      { opacity: 1; }
  22%      { opacity: .5; }
  30%      { opacity: .2; }
  56%      { opacity: .5; }
  60%      { opacity: 1; }
  64%      { opacity: .5; }
  72%      { opacity: .2; }
  80%      { opacity: .5; }
  84%      { opacity: 1; }
  88%      { opacity: .5; }
  94%      { opacity: .2; }
}

@keyframes m8 {
  0%, 100% { opacity: .2; }
  5%       { opacity: .5; }
  9%       { opacity: 1; }
  13%      { opacity: .5; }
  20%      { opacity: .2; }
  52%      { opacity: .5; }
  56%      { opacity: 1; }
  60%      { opacity: .5; }
  68%      { opacity: .2; }
  72%      { opacity: .5; }
  76%      { opacity: 1; }
  80%      { opacity: .5; }
  88%      { opacity: .2; }
}

@keyframes m9 {
  0%, 100% { opacity: 1; }
  4%       { opacity: .5; }
  12%      { opacity: .2; }
  28%      { opacity: .2; }
  32%      { opacity: .5; }
  36%      { opacity: 1; }
  40%      { opacity: .5; }
  44%      { opacity: .2; }
  48%      { opacity: .5; }
  52%      { opacity: 1; }
  56%      { opacity: .5; }
  60%      { opacity: .2; }
  64%      { opacity: .5; }
  68%      { opacity: 1; }
  72%      { opacity: .5; }
  80%      { opacity: .2; }
  92%      { opacity: .2; }
  96%      { opacity: .5; }
}
</style>
