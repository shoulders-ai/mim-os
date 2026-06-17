<script setup>
import { computed } from "vue";
import {
    IconArchiveOff,
    IconCheck,
    IconChevronDown,
    IconShield,
} from "@tabler/icons-vue";
import MimMenu from "../ui/MimMenu.vue";
import MimMenuItem from "../ui/MimMenuItem.vue";
import { shortcutLabel } from "../../services/shortcutLabels.js";

const props = defineProps({
    mode: { type: String, default: "normal" },
    modes: { type: Array, default: () => [] },
    canMarkDone: { type: Boolean, default: false },
    isArchived: { type: Boolean, default: false },
    layout: { type: String, default: "dock" },
});

const emit = defineEmits(["update:mode", "done", "restore"]);

const fallbackModes = [
    { id: "strict", label: "Strict", desc: "Ask before every action" },
    {
        id: "normal",
        label: "Normal",
        desc: "Ask before changes and outside requests",
    },
    { id: "developer", label: "Allow all", desc: "No approval prompts" },
];

const modeRows = computed(() =>
    props.modes.length ? props.modes : fallbackModes,
);
const currentMode = computed(
    () =>
        modeRows.value.find((mode) => mode.id === props.mode) ??
        modeRows.value[0],
);
const isDeveloperMode = computed(() => currentMode.value?.id === "developer");
const rowClass = computed(() =>
    props.layout === "landing"
        ? "mt-2 flex h-5 w-full items-center justify-between"
        : "mx-auto flex h-5 w-full max-w-[calc(720px+64px)] items-center justify-between px-8 pb-3 pt-1",
);
const approvalTriggerClass = computed(() =>
    [
        "h-[22px] gap-1 rounded-[4px] px-1.5 font-sans text-[10.5px] hover:bg-chrome-mid",
        isDeveloperMode.value
            ? "text-rem hover:text-rem"
            : "text-ink-3 hover:text-ink-2",
    ].join(" "),
);

function selectMode(mode) {
    emit("update:mode", mode.id);
}
</script>

<template>
    <div :class="rowClass">
        <div class="flex min-w-0 items-center gap-1">
            <MimMenu
                aria-label="Automation approval mode"
                title="Automation approval mode"
                placement="top-start"
                :trigger-class="approvalTriggerClass"
                items-class="w-48 rounded-[6px]"
            >
                <template #trigger>
                    <IconShield :size="11" :stroke-width="2" />
                    <span>{{ currentMode?.label || mode }}</span>
                    <IconChevronDown :size="9" :stroke-width="2.4" />
                </template>

                <MimMenuItem
                    v-for="option in modeRows"
                    :key="option.id"
                    :selected="option.id === mode"
                    :danger="option.id === 'developer'"
                    item-class="flex-col items-start gap-0.5 rounded-[4px] px-2.5 py-1.5"
                    @select="selectMode(option)"
                >
                    <span
                        class="font-sans text-[11.5px] font-medium text-ink-2"
                        :class="{
                            'font-semibold text-accent':
                                option.id === mode && option.id !== 'developer',
                            'font-semibold text-rem': option.id === 'developer',
                        }"
                        >{{ option.label }}</span
                    >
                    <span
                        class="font-sans text-[10px] font-normal leading-tight text-ink-3"
                        >{{ option.desc }}</span
                    >
                </MimMenuItem>
            </MimMenu>
        </div>

        <div class="flex items-center justify-end">
            <button
                v-if="isArchived"
                type="button"
                class="inline-flex h-[22px] items-center gap-1 rounded-[4px] px-1.5 font-sans text-[10.5px] font-medium text-accent hover:bg-accent-tint"
                title="Unarchive this chat"
                @click="$emit('restore')"
            >
                <IconArchiveOff :size="11" :stroke-width="2" />
                <span>Unarchive</span>
            </button>
            <button
                v-else-if="canMarkDone"
                type="button"
                class="inline-flex h-[22px] items-center gap-1 rounded-[4px] px-1.5 font-sans text-[10.5px] text-ink-3 hover:bg-chrome-mid hover:text-ink-2"
                :title="`Mark done and archive this chat (${shortcutLabel(['Mod', 'Shift', 'D'])})`"
                @click="$emit('done')"
            >
                <IconCheck :size="11" :stroke-width="2.2" />
                <span>Done</span>
            </button>
        </div>
    </div>
</template>
