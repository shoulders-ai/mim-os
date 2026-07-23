<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { IconPlus, IconSearch } from '@tabler/icons-vue'
import MimDialog from '../ui/MimDialog.vue'
import MimToggle from '../ui/MimToggle.vue'

type SkillOrigin = 'mim' | 'team' | 'personal' | 'project'
type SkillDestination = 'personal' | 'project' | 'team'

interface SkillItem {
  id: string
  name: string
  description: string
  source: SkillOrigin
  sourceName?: string
  editorPath?: string
  enabled: boolean
  shadows: Array<{ source: SkillOrigin }>
}

const skills = ref<SkillItem[]>([])
const loading = ref(true)
const error = ref('')
const query = ref('')
const projectName = ref('Project')
const teamName = ref('')
const newOpen = ref(false)
const newName = ref('')
const newDescription = ref('')
const destination = ref<SkillDestination>('personal')
const creating = ref(false)

const filteredSkills = computed(() => {
  const needle = query.value.trim().toLowerCase()
  if (!needle) return skills.value
  return skills.value.filter(skill =>
    `${skill.name} ${skill.description} ${originLabel(skill)}`.toLowerCase().includes(needle),
  )
})

const destinations = computed(() => [
  { value: 'personal' as const, label: 'You' },
  { value: 'project' as const, label: projectName.value },
  ...(teamName.value ? [{ value: 'team' as const, label: teamName.value }] : []),
])

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [catalog, project, team] = await Promise.all([
      window.kernel.call('skill.list', { detailed: true }) as Promise<{ skills?: SkillItem[] }>,
      window.kernel.call('workspace.info', {}) as Promise<{ name?: string }>,
      window.kernel.call('team.status', {}) as Promise<{ team?: { name?: string } | null }>,
    ])
    skills.value = catalog.skills ?? []
    projectName.value = project.name?.trim() || 'Project'
    teamName.value = team.team?.name?.trim() || ''
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

function originLabel(skill: SkillItem): string {
  if (skill.source === 'personal') return 'You'
  if (skill.source === 'project') return projectName.value
  if (skill.source === 'team') return skill.sourceName || teamName.value || 'Team'
  return 'Mim'
}

async function openSkill(skill: SkillItem) {
  if (!skill.editorPath) return
  error.value = ''
  try {
    await window.kernel.call('editor.open', { path: skill.editorPath })
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function setEnabled(skill: SkillItem, enabled: boolean) {
  const previous = skill.enabled
  skill.enabled = enabled
  try {
    await window.kernel.call('skill.setDisabled', {
      name: skill.name,
      disabled: !enabled,
    })
  } catch (err) {
    skill.enabled = previous
    error.value = err instanceof Error ? err.message : String(err)
  }
}

function showCreate() {
  newName.value = ''
  newDescription.value = ''
  destination.value = 'personal'
  newOpen.value = true
}

async function createSkill() {
  const name = newName.value.trim()
  if (!name || creating.value) return
  creating.value = true
  error.value = ''
  try {
    const params: Record<string, unknown> = {
      name,
      destination: destination.value,
    }
    if (newDescription.value.trim()) params.description = newDescription.value.trim()
    const result = await window.kernel.call('skill.create', params) as {
      skill?: { editorPath?: string }
    }
    newOpen.value = false
    await load()
    if (result.skill?.editorPath) {
      await window.kernel.call('editor.open', { path: result.skill.editorPath })
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    creating.value = false
  }
}

function onSkillsChanged() {
  void load()
}

onMounted(() => {
  window.kernel.on('skills:changed', onSkillsChanged)
  void load()
})

onBeforeUnmount(() => {
  window.kernel.off('skills:changed', onSkillsChanged)
})
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col text-ink" aria-label="Skills settings">
    <div class="flex items-center gap-2 border-b border-rule-light pb-3">
      <label class="relative min-w-0 flex-1">
        <IconSearch :size="13" class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-3" />
        <input
          v-model="query"
          data-testid="skill-search"
          type="search"
          placeholder="Search skills"
          class="h-7 w-full rounded-[5px] border border-rule-light bg-surface pl-7 pr-2 text-[11px] text-ink outline-none placeholder:text-ink-4 focus:border-accent"
        >
      </label>
      <button
        type="button"
        data-testid="skill-new-open"
        class="flex h-7 shrink-0 items-center gap-1.5 rounded-[5px] border border-rule-light bg-chrome-high px-2.5 text-[11px] font-medium text-ink-2 hover:bg-chrome-mid"
        @click="showCreate"
      >
        <IconPlus :size="13" />
        New
      </button>
    </div>

    <div v-if="loading" class="py-8 text-center text-[11px] text-ink-3">Loading...</div>
    <div v-else-if="filteredSkills.length === 0" class="py-8 text-center text-[11px] text-ink-3">
      No matching skills
    </div>
    <div v-else class="min-h-0 flex-1 divide-y divide-rule-light overflow-y-auto">
      <div
        v-for="skill in filteredSkills"
        :key="skill.id"
        class="flex items-center gap-3 rounded-[4px] px-2 py-2 hover:bg-chrome-mid"
      >
        <button
          type="button"
          :data-testid="`skill-open-${skill.name}`"
          class="min-w-0 flex-1 text-left"
          @click="openSkill(skill)"
        >
          <span class="flex min-w-0 items-center gap-2">
            <span class="truncate text-[11.5px] font-medium text-ink">{{ skill.name }}</span>
            <span class="shrink-0 rounded-[3px] bg-chrome-mid px-1.5 py-0.5 text-[9px] font-medium text-ink-3">
              {{ originLabel(skill) }}
            </span>
          </span>
          <span class="mt-0.5 block truncate text-[10.5px] text-ink-3">{{ skill.description }}</span>
        </button>
        <MimToggle
          :model-value="skill.enabled"
          :aria-label="`${skill.name} ${skill.enabled ? 'enabled' : 'disabled'}`"
          @update:model-value="setEnabled(skill, $event)"
        />
      </div>
    </div>

    <p v-if="error" class="mt-2 text-[11px] text-rem">{{ error }}</p>

    <MimDialog :open="newOpen" title="New skill" size="sm" @close="newOpen = false">
      <form class="flex flex-col gap-3 p-4" @submit.prevent="createSkill">
        <label class="flex flex-col gap-1 text-[10.5px] text-ink-3">
          Name
          <input
            v-model="newName"
            data-testid="skill-new-name"
            type="text"
            placeholder="research-plan"
            class="h-8 rounded-[5px] border border-rule-light bg-surface px-2 text-[11.5px] text-ink outline-none focus:border-accent"
          >
        </label>
        <label class="flex flex-col gap-1 text-[10.5px] text-ink-3">
          Description
          <input
            v-model="newDescription"
            data-testid="skill-new-description"
            type="text"
            placeholder="Use when..."
            class="h-8 rounded-[5px] border border-rule-light bg-surface px-2 text-[11.5px] text-ink outline-none focus:border-accent"
          >
        </label>
        <fieldset class="flex flex-col gap-1.5">
          <legend class="text-[10.5px] text-ink-3">Destination</legend>
          <div class="grid grid-cols-3 gap-1.5">
            <button
              v-for="item in destinations"
              :key="item.value"
              type="button"
              :data-testid="`skill-destination-${item.value}`"
              class="rounded-[5px] border px-2 py-1.5 text-[10.5px] hover:bg-chrome-mid"
              :class="destination === item.value ? 'border-accent bg-accent-soft text-accent' : 'border-rule-light text-ink-2'"
              @click="destination = item.value"
            >
              {{ item.label }}
            </button>
          </div>
        </fieldset>
        <div class="mt-1 flex justify-end gap-2">
          <button type="button" class="rounded-[5px] px-3 py-1.5 text-[11px] text-ink-2 hover:bg-chrome-mid" @click="newOpen = false">
            Cancel
          </button>
          <button
            type="submit"
            data-testid="skill-create"
            :disabled="!newName.trim() || creating"
            class="rounded-[5px] bg-accent px-3 py-1.5 text-[11px] font-medium text-accent-ink hover:bg-accent/90 disabled:opacity-40"
          >
            Create
          </button>
        </div>
      </form>
    </MimDialog>
  </section>
</template>
