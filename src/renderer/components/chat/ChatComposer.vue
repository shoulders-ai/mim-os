<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from "vue";
import ModelPicker from "./ModelPicker.vue";
import ControlPicker from "./ControlPicker.vue";
import ContextDonut from "./ContextDonut.vue";
import MimMenu from "../ui/MimMenu.vue";
import MimMenuItem from "../ui/MimMenuItem.vue";
import { validateFileSize } from "../../services/attachments.js";
import {
    IconArrowUp,
    IconBolt,
    IconFile,
    IconFileText,
    IconPhoto,
    IconPlayerStop,
    IconPlus,
    IconTool,
} from "@tabler/icons-vue";
import {
    buildAtItems,
    canSendMessage,
    filterAtItems,
    getAtMentionState,
    groupAtItems,
    removeAtMention,
    upsertContextChip,
} from "./composerLogic.js";

const props = defineProps({
    modelId: String,
    models: { type: Array, default: () => [] },
    controlId: String,
    controlLabel: { type: String, default: "Control" },
    controlOptions: { type: Array, default: () => [] },
    disabled: Boolean,
    busy: Boolean,
    canSend: { type: Boolean, default: true },
    costLabel: { type: String, default: "" },
    contextPercent: { type: Number, default: 0 },
    contextTokens: { type: Number, default: 0 },
    contextWindow: { type: Number, default: 0 },
    showUsageIndicators: { type: Boolean, default: false },
    supportsVision: { type: Boolean, default: false },
    skills: { type: Array, default: () => [] },
    projectFiles: { type: Array, default: () => [] },
    packageTools: { type: Array, default: () => [] },
    hasDocument: { type: Boolean, default: false },
    documentName: { type: String, default: "" },
    placeholder: String,
    layout: { type: String, default: "dock" },
});

const emit = defineEmits([
    "send",
    "stop",
    "update:modelId",
    "update:controlId",
    "start-fresh",
]);

const draft = ref("");
const inputEl = ref(null);
const wrapEl = ref(null);
const attachments = ref([]);
const attachError = ref("");
const dropActive = ref(false);
const contextChips = ref([]);

// @ mention state
const cursorPos = ref(0);
const atHighlight = ref(-1);
const atDropdownRef = ref(null);

let errorTimer = null;

const visibleAttachments = computed(() =>
    attachments.value.map((a, i) => ({ ...a, _idx: i })),
);

const composerPlaceholder = computed(
    () => props.placeholder || "Ask anything. Use @ to mention skills or files",
);
const showContextDonut = computed(() => props.contextWindow > 0);
const wrapClass = computed(() =>
    props.layout === "landing"
        ? "relative w-full px-0 pb-0 max-w-none mx-auto"
        : "relative w-full px-8 pb-0.5 max-w-[calc(720px+64px)] mx-auto",
);

// --- @ mention detection ---

function updateCursor() {
    cursorPos.value = inputEl.value?.selectionStart ?? 0;
}

const atMentionState = computed(() =>
    getAtMentionState(draft.value, cursorPos.value),
);
const atQuery = computed(() => atMentionState.value.query);
const atActive = computed(() => atMentionState.value.active);
const allAtItems = computed(() =>
    buildAtItems({
        skills: props.skills,
        projectFiles: props.projectFiles,
        packageTools: props.packageTools,
        hasDocument: props.hasDocument,
        documentName: props.documentName,
    }),
);
const atItems = computed(() =>
    filterAtItems(atQuery.value, atActive.value, allAtItems.value),
);
const groupedAtItems = computed(() => groupAtItems(atItems.value));

const showAtDropdown = computed(
    () => atActive.value && atItems.value.length > 0,
);

const localCanSend = computed(() =>
    canSendMessage({
        canSend: props.canSend,
        disabled: props.disabled,
        busy: props.busy,
        draft: draft.value,
        attachments: attachments.value,
        contextChips: contextChips.value,
        showAtDropdown: showAtDropdown.value,
    }),
);

const atDropdownPos = ref({});

function updateAtDropdownPos() {
    if (!wrapEl.value) return;
    const rect = wrapEl.value.getBoundingClientRect();
    atDropdownPos.value = {
        left: rect.left + "px",
        width: rect.width + "px",
        bottom: window.innerHeight - rect.top + 6 + "px",
    };
}

watch(showAtDropdown, (val) => {
    if (val) nextTick(updateAtDropdownPos);
    if (!val) atHighlight.value = -1;
});

watch(atHighlight, (idx) => {
    if (idx < 0 || !atDropdownRef.value) return;
    nextTick(() => {
        const items = atDropdownRef.value?.querySelectorAll("button");
        items?.[idx]?.scrollIntoView({ block: "nearest" });
    });
});

function selectAtItem(item) {
    const nextDraft = removeAtMention(draft.value, cursorPos.value);
    if (nextDraft.removed) {
        draft.value = nextDraft.text;
        nextTick(() => {
            const newPos = nextDraft.cursorPos;
            inputEl.value?.setSelectionRange(newPos, newPos);
            cursorPos.value = newPos;
            autoResize();
        });
    }

    contextChips.value = upsertContextChip(contextChips.value, item);

    inputEl.value?.focus();
}

function pickContextItem(item) {
    contextChips.value = upsertContextChip(contextChips.value, item);
    inputEl.value?.focus();
}

function removeContextChip(idx) {
    contextChips.value.splice(idx, 1);
}

function clearContextChips() {
    contextChips.value = [];
}

function prepareDraft(payload = {}) {
    draft.value = String(payload.text || "");
    attachments.value = [];
    contextChips.value = [];
    for (const att of payload.attachments || []) {
        addAttachment(att);
    }
    for (const chip of payload.contextChips || []) {
        contextChips.value = upsertContextChip(contextChips.value, chip);
    }
    nextTick(() => {
        autoResize();
        inputEl.value?.focus();
    });
}

function contextChipIcon(chip) {
    if (chip?.type === "skill") return IconBolt;
    if (chip?.type === "package-tool") return IconTool;
    if (chip?.type === "document") return IconFileText;
    return IconFile;
}

function attachmentIcon(att) {
    return isImageAttachment(att) ? IconPhoto : IconFileText;
}

function atItemIcon(item) {
    if (item?.type === "skill") return IconBolt;
    if (item?.type === "package-tool") return IconTool;
    if (item?.type === "document") return IconFileText;
    return IconFile;
}

// --- Auto resize ---

function autoResize() {
    const el = inputEl.value;
    if (!el) return;
    el.style.height = "auto";
    const scrollH = el.scrollHeight;
    el.style.height = Math.min(scrollH, 180) + "px";
    el.style.overflowY = scrollH > 180 ? "auto" : "hidden";
}

function onInput() {
    autoResize();
    updateCursor();
}

function onKeydown(e) {
    // Shift+Enter is always a native textarea newline, even while the @ menu is open.
    if (e.key === "Enter" && e.shiftKey) return;

    // Handle @ dropdown navigation
    if (showAtDropdown.value) {
        const totalItems = atItems.value.length;
        if (e.key === "ArrowDown" && totalItems > 0) {
            e.preventDefault();
            atHighlight.value = (atHighlight.value + 1) % totalItems;
            return;
        }
        if (e.key === "ArrowUp" && totalItems > 0) {
            e.preventDefault();
            atHighlight.value =
                (atHighlight.value - 1 + totalItems) % totalItems;
            return;
        }
        if (e.key === "Enter") {
            if (atHighlight.value >= 0 && atHighlight.value < totalItems) {
                e.preventDefault();
                e.stopPropagation();
                selectAtItem(atItems.value[atHighlight.value]);
            } else {
                e.preventDefault();
            }
            return;
        }
        if (e.key === "Escape") {
            e.preventDefault();
            // Remove the @query to dismiss dropdown
            const text = draft.value;
            const pos = cursorPos.value;
            const before = text.slice(0, pos);
            const atIdx = before.lastIndexOf("@");
            if (atIdx >= 0) {
                draft.value = text.slice(0, atIdx) + text.slice(pos);
                nextTick(() => {
                    inputEl.value?.setSelectionRange(atIdx, atIdx);
                    cursorPos.value = atIdx;
                    autoResize();
                });
            }
            return;
        }
    }

    // Enter sends; Shift+Enter keeps the textarea newline behavior.
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
    }
}

function send() {
    const text = draft.value.trim();
    if (
        !canSendMessage({
            canSend: props.canSend,
            disabled: props.disabled,
            busy: props.busy,
            draft: draft.value,
            attachments: attachments.value,
            contextChips: contextChips.value,
            showAtDropdown: showAtDropdown.value,
        })
    )
        return;
    emit("send", {
        text,
        attachments: [...attachments.value],
        contextChips: [...contextChips.value],
    });
    draft.value = "";
    attachments.value = [];
    contextChips.value = [];
    nextTick(autoResize);
}

// --- File attachments ---

function addAttachment(att) {
    if (att.size != null && !validateFileSize(att.size)) {
        setAttachError("File too large (max 20 MB)");
        return;
    }
    attachments.value.push(att);
}

function removeAttachment(idx) {
    attachments.value.splice(idx, 1);
}

function clearAttachments() {
    attachments.value = [];
}

function scheduleErrorClear() {
    if (errorTimer) clearTimeout(errorTimer);
    errorTimer = setTimeout(() => {
        attachError.value = "";
    }, 3000);
}

function setAttachError(message) {
    attachError.value = message;
    scheduleErrorClear();
}

async function pickAttach(type) {
    try {
        const result = await window.kernel.pickAttachments({ kind: type });
        addKernelAttachments(result?.attachments || []);
    } catch (err) {
        setAttachError(attachmentErrorMessage(err));
    }
}

function addKernelAttachments(nextAttachments) {
    for (const att of nextAttachments) {
        if (isImageAttachment(att) && !props.supportsVision) {
            setAttachError("Current model does not support images");
            continue;
        }
        addAttachment(att);
    }
}

function isImageAttachment(att) {
    return (
        att?.type === "image" ||
        String(att?.mediaType || "").startsWith("image/")
    );
}

function attachmentErrorMessage(err) {
    const message = err instanceof Error ? err.message : String(err || "");
    if (message.includes("File too large")) return "File too large (max 20 MB)";
    if (message.includes("Not a file")) return "Only files can be attached";
    return message || "Could not attach file";
}

function focus() {
    inputEl.value?.focus();
}

// Handle file drops on the composer
function onDragEnter(e) {
    e.preventDefault();
    dropActive.value = true;
}
function onDragOver(e) {
    e.preventDefault();
    dropActive.value = true;
}
function onDragLeave(e) {
    e.preventDefault();
    dropActive.value = false;
}
async function onDrop(e) {
    e.preventDefault();
    dropActive.value = false;
    const files = Array.from(e.dataTransfer?.files || []);
    if (!files.length) return;

    const paths = files
        .map((file) => window.kernel.getPathForFile?.(file))
        .filter((path) => typeof path === "string" && path.length > 0);

    if (!paths.length) {
        setAttachError("Could not read dropped file path");
        return;
    }

    try {
        const result = await window.kernel.readAttachments(paths);
        addKernelAttachments(result?.attachments || []);
    } catch (err) {
        setAttachError(attachmentErrorMessage(err));
    }
}

onMounted(() => {
    nextTick(() => inputEl.value?.focus());
});
onUnmounted(() => {
    if (errorTimer) clearTimeout(errorTimer);
});

defineExpose({
    focus,
    draft,
    attachments,
    addAttachment,
    removeAttachment,
    clearAttachments,
    contextChips,
    clearContextChips,
    prepareDraft,
    setAttachError,
    autoResize,
});
</script>

<template>
    <div ref="wrapEl" :class="wrapClass">
        <div
            class="@container relative bg-surface border border-rule rounded-[14px] px-3.5 pt-3 pb-2.5 shadow-[0_1px_0_rgba(0,0,0,0.03),0_12px_30px_-22px_rgba(0,0,0,0.15)] focus-within:border-ink-4"
            :class="dropActive ? 'border-accent' : ''"
            @dragenter="onDragEnter"
            @dragover="onDragOver"
            @dragleave="onDragLeave"
            @drop="onDrop"
        >
            <!-- Drop overlay -->
            <div
                v-if="dropActive"
                class="absolute inset-0 z-10 flex items-center justify-center gap-1.5 rounded-[13px] pointer-events-none bg-accent-soft font-sans text-xs font-medium text-accent"
            >
                <IconPlus :size="16" />
                <span>Drop to attach</span>
            </div>

            <!-- Context chips + Attachment chips -->
            <div
                v-if="contextChips.length || visibleAttachments.length"
                class="flex flex-wrap gap-1 mb-2"
            >
                <!-- Context chips -->
                <span
                    v-for="(chip, idx) in contextChips"
                    :key="'ctx-' + chip.type + '-' + chip.id"
                    class="inline-flex items-center gap-1 h-[22px] px-1.5 rounded-[5px] font-sans text-[11px] bg-accent-tint text-ink-2"
                >
                    <component
                        :is="contextChipIcon(chip)"
                        :size="11"
                        :stroke-width="chip.type === 'skill' ? 2.5 : 2"
                    />
                    <span
                        class="max-w-[140px] overflow-hidden text-ellipsis whitespace-nowrap"
                        >{{ chip.label }}</span
                    >
                    <button
                        class="inline-flex items-center justify-center w-3.5 h-3.5 rounded-[3px] text-xs leading-none text-ink-3 hover:bg-rule hover:text-ink"
                        @click="removeContextChip(idx)"
                    >
                        &times;
                    </button>
                </span>

                <!-- Attachment chips -->
                <span
                    v-for="att in visibleAttachments"
                    :key="'att-' + att._idx"
                    class="inline-flex items-center gap-1 h-[22px] px-1.5 rounded-[5px] font-sans text-[11px] bg-chrome-high text-ink-2"
                >
                    <component :is="attachmentIcon(att)" :size="11" />
                    <span
                        class="max-w-[140px] overflow-hidden text-ellipsis whitespace-nowrap"
                        >{{ att.filename }}</span
                    >
                    <button
                        class="inline-flex items-center justify-center w-3.5 h-3.5 rounded-[3px] text-xs leading-none text-ink-3 hover:bg-rule hover:text-ink"
                        @click="removeAttachment(att._idx)"
                    >
                        &times;
                    </button>
                </span>
            </div>

            <div v-if="attachError" class="font-sans text-[11px] text-rem my-1">
                {{ attachError }}
            </div>

            <!-- Textarea -->
            <div class="relative w-full">
                <div
                    v-if="!draft"
                    class="absolute inset-x-0 top-0 h-[30px] overflow-hidden whitespace-nowrap pointer-events-none font-sans text-[14px] italic leading-[1.5] text-ink-3"
                >
                    {{ composerPlaceholder }}
                </div>
                <textarea
                    ref="inputEl"
                    v-model="draft"
                    class="w-full border-0 bg-transparent font-sans text-[14px] text-ink outline-none leading-[1.5] resize-none overflow-y-hidden min-h-[30px] max-h-[180px] disabled:opacity-50"
                    rows="1"
                    :aria-label="composerPlaceholder"
                    autocomplete="off"
                    autocorrect="off"
                    autocapitalize="off"
                    spellcheck="false"
                    :disabled="disabled"
                    @keydown="onKeydown"
                    @input="onInput"
                    @click="updateCursor"
                    @keyup="updateCursor"
                />
            </div>

            <!-- Bottom row: left (attach) + right (streaming indicator, usage, model, send/stop) -->
            <div
                class="flex items-center justify-between mt-1.5 pt-1.5 min-w-0"
            >
                <!-- Left: attach button -->
                <div class="flex items-center gap-2 shrink-0">
                    <MimMenu
                        aria-label="Attach file"
                        title="Attach file"
                        placement="top-start"
                        :disabled="disabled"
                        trigger-class="h-[30px] w-[30px] justify-center rounded-lg border border-rule bg-surface text-ink-2 hover:bg-chrome-high hover:text-ink disabled:opacity-30"
                        items-class="min-w-[240px] max-w-[min(340px,80vw)] rounded-[10px]"
                    >
                        <template #trigger>
                            <IconPlus :size="14" />
                        </template>

                        <MimMenuItem
                            v-if="supportsVision"
                            item-class="rounded-md px-2.5 py-[7px] text-xs text-ink"
                            @select="pickAttach('image')"
                        >
                            <IconPhoto :size="13" class="text-ink-3 shrink-0" />
                            <span
                                class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
                                >Image</span
                            >
                        </MimMenuItem>
                        <MimMenuItem
                            item-class="rounded-md px-2.5 py-[7px] text-xs text-ink"
                            @select="pickAttach('file')"
                        >
                            <IconFileText
                                :size="13"
                                class="text-ink-3 shrink-0"
                            />
                            <span
                                class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
                                >Attach file...</span
                            >
                        </MimMenuItem>
                        <MimMenuItem
                            v-if="hasDocument"
                            item-class="rounded-md px-2.5 py-[7px] text-xs text-ink"
                            @select="
                                pickContextItem({
                                    type: 'document',
                                    id: 'current-document',
                                    label: documentName || 'Current document',
                                    group: 'Document',
                                })
                            "
                        >
                            <IconFile :size="13" class="text-ink-3 shrink-0" />
                            <span
                                class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
                                >Current document</span
                            >
                        </MimMenuItem>
                        <template
                            v-if="
                                projectFiles.length ||
                                skills.length ||
                                packageTools.length
                            "
                        >
                            <div class="h-px bg-rule-light my-1 mx-0.5" />
                            <div
                                v-if="projectFiles.length"
                                class="px-2.5 pt-[5px] pb-0.5 font-sans text-[10px] font-bold uppercase tracking-[0.04em] text-ink-3"
                            >
                                Files
                            </div>
                            <MimMenuItem
                                v-for="file in projectFiles.slice(0, 6)"
                                :key="'menu-file-' + file.path"
                                item-class="rounded-md px-2.5 py-[7px] text-xs text-ink"
                                @select="
                                    pickContextItem({
                                        type: 'project-file',
                                        id: file.path,
                                        label:
                                            file.name ||
                                            file.path.split('/').pop(),
                                        desc: file.path,
                                        path: file.path,
                                        mediaType: file.mediaType,
                                        group: 'Files',
                                    })
                                "
                            >
                                <IconFileText
                                    :size="13"
                                    class="text-ink-3 shrink-0"
                                />
                                <span
                                    class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
                                    >{{ file.name || file.path }}</span
                                >
                            </MimMenuItem>
                            <div
                                v-if="skills.length"
                                class="px-2.5 pt-[5px] pb-0.5 font-sans text-[10px] font-bold uppercase tracking-[0.04em] text-ink-3"
                            >
                                Skills
                            </div>
                            <MimMenuItem
                                v-for="skill in skills"
                                :key="'menu-skill-' + skill.id"
                                item-class="rounded-md px-2.5 py-[7px] text-xs text-ink"
                                @select="
                                    pickContextItem({
                                        type: 'skill',
                                        id: skill.id,
                                        label:
                                            skill.name ||
                                            skill.label ||
                                            skill.id,
                                        desc: skill.desc || skill.description,
                                        packageName: skill.packageName,
                                        group: 'Skills',
                                    })
                                "
                            >
                                <IconBolt
                                    :size="13"
                                    :stroke-width="2.5"
                                    class="text-ink-3 shrink-0"
                                />
                                <span
                                    class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
                                    >{{
                                        skill.name || skill.label || skill.id
                                    }}</span
                                >
                            </MimMenuItem>
                            <div
                                v-if="packageTools.length"
                                class="px-2.5 pt-[5px] pb-0.5 font-sans text-[10px] font-bold uppercase tracking-[0.04em] text-ink-3"
                            >
                                Tools
                            </div>
                            <MimMenuItem
                                v-for="tool in packageTools.slice(0, 6)"
                                :key="'menu-tool-' + (tool.id || tool.name)"
                                item-class="rounded-md px-2.5 py-[7px] text-xs text-ink"
                                @select="
                                    pickContextItem({
                                        type: 'package-tool',
                                        id: tool.id || tool.name,
                                        label: tool.label || tool.name,
                                        desc: tool.description,
                                        packageName: tool.packageName,
                                        group: 'Tools',
                                    })
                                "
                            >
                                <IconTool
                                    :size="13"
                                    :stroke-width="2.2"
                                    class="text-ink-3 shrink-0"
                                />
                                <span
                                    class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
                                    >{{ tool.label || tool.name }}</span
                                >
                            </MimMenuItem>
                        </template>
                    </MimMenu>
                </div>

                <!-- Right: indicators, model/control pickers, stop/send -->
                <div
                    class="flex items-center gap-2 flex-1 min-w-0 justify-end flex-nowrap @max-[360px]:flex-[0_0_auto]"
                >
                    <!-- Usage indicators -->
                    <ContextDonut
                        v-if="showContextDonut"
                        :percent="contextPercent"
                        :token-count="contextTokens"
                        :context-window="contextWindow"
                        :cost-label="costLabel"
                        :size="16"
                        @start-fresh="emit('start-fresh')"
                    />
                    <span
                        v-else-if="showUsageIndicators && costLabel"
                        class="text-[11px] text-ink-3 font-mono @max-[360px]:hidden"
                        >{{ costLabel }}</span
                    >

                    <!-- Model picker -->
                    <ModelPicker
                        :model-id="modelId"
                        :models="models"
                        :disabled="disabled"
                        @update:model-id="$emit('update:modelId', $event)"
                    />
                    <ControlPicker
                        class="@max-[360px]:hidden"
                        :control-id="controlId"
                        :label="controlLabel"
                        :options="controlOptions"
                        :disabled="disabled || controlOptions.length === 0"
                        @update:control-id="$emit('update:controlId', $event)"
                    />

                    <!-- Stop / Send button -->
                    <button
                        v-if="busy"
                        class="w-[30px] h-[30px] rounded-lg inline-flex items-center justify-center shrink-0 bg-accent text-surface hover:bg-accent-2"
                        type="button"
                        title="Stop generation"
                        @click="$emit('stop')"
                    >
                        <IconPlayerStop :size="13" />
                    </button>
                    <button
                        v-else
                        class="w-[30px] h-[30px] rounded-lg inline-flex items-center justify-center shrink-0 bg-ink text-surface hover:bg-accent disabled:opacity-25 disabled:pointer-events-none"
                        :disabled="!localCanSend"
                        title="Send message (Enter)"
                        @click="send"
                    >
                        <IconArrowUp :size="14" :stroke-width="2.5" />
                    </button>
                </div>
            </div>
        </div>

        <!-- @ dropdown — teleported to escape overflow:hidden ancestors -->
        <Teleport to="body">
            <div
                v-if="showAtDropdown"
                ref="atDropdownRef"
                class="fixed z-[9999] bg-surface border border-rule rounded-[10px] shadow-[0_8px_30px_rgba(0,0,0,0.15)] max-h-[340px] overflow-y-auto p-1"
                :style="atDropdownPos"
            >
                <template
                    v-for="group in groupedAtItems"
                    :key="'group-' + group.label"
                >
                    <div
                        class="px-2.5 pt-1.5 pb-0.5 first:pt-[3px] font-sans text-[10px] font-bold uppercase tracking-[0.04em] text-ink-3"
                    >
                        {{ group.label }}
                    </div>
                    <button
                        v-for="item in group.items"
                        :key="'at-' + item.type + '-' + item.id"
                        class="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-left hover:bg-chrome-high"
                        :class="{
                            'bg-chrome-high':
                                atHighlight === atItems.indexOf(item),
                        }"
                        @click="selectAtItem(item)"
                        @pointerenter="atHighlight = atItems.indexOf(item)"
                    >
                        <span class="flex items-center text-ink-3 shrink-0">
                            <component
                                :is="atItemIcon(item)"
                                :size="13"
                                :stroke-width="item.type === 'skill' ? 2.5 : 2"
                            />
                        </span>
                        <div class="flex-1 min-w-0">
                            <div
                                class="font-sans text-xs font-medium text-ink leading-[1.3]"
                            >
                                {{ item.label }}
                            </div>
                            <div
                                v-if="item.desc"
                                class="font-sans text-[10.5px] text-ink-3 whitespace-nowrap overflow-hidden text-ellipsis"
                            >
                                {{ item.desc }}
                            </div>
                        </div>
                    </button>
                </template>
            </div>
        </Teleport>
    </div>
</template>
