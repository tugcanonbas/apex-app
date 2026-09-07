<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		isAdaptive,
		previewCompact = false,
		showHeader = true,
		children
	}: {
		isAdaptive: boolean;
		previewCompact?: boolean;
		showHeader?: boolean;
		children: Snippet;
	} = $props();
</script>

<section
	class="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col bg-canvas px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]"
	class:aic-shell={isAdaptive}
	class:preview-device={previewCompact}
	data-log-surface="participant_app_shell"
>
	{#if showHeader}
		<header class="flex h-11 items-center" data-log-surface="app_header">
			<img src="/logo.png" alt="VERDĒ" class="h-5 w-auto" data-log-target="app_logo" />
		</header>
	{/if}

	{@render children()}
</section>

<style>
	.aic-shell {
		background: #fbfdfc;
	}

	.preview-device {
		width: 440px;
		height: 956px;
		min-height: 956px;
		max-height: 956px;
		max-width: none;
		overflow: visible;
	}
</style>
