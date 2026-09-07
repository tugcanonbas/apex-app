<script lang="ts">
	import VerdeIcon from '$lib/components/VerdeIcon.svelte';
	import type { DetailTopic, IconName } from './rideTypes';

	let {
		topic,
		label,
		icon,
		source,
		className,
		full = false,
		onOpen
	}: {
		topic: DetailTopic;
		label: string;
		icon: IconName;
		source: string;
		className: string;
		full?: boolean;
		onOpen: (topic: DetailTopic, source: string) => void;
	} = $props();
</script>

<button
	class="verde-focus inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-xs font-bold {className}"
	class:w-full={full}
	data-log-target={`detail_button:${topic}`}
	data-log-type="detail_button"
	data-log-surface={source}
	onclick={() => onOpen(topic, source)}
>
	<VerdeIcon name={icon} size={15} />
	{label}
</button>
