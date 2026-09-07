<script lang="ts">
	import type { SicBoardingStep } from '$lib/types';

	let { step }: { step: SicBoardingStep } = $props();

	const screens: Record<
		SicBoardingStep,
		{ title: string; subtitle: string; image: string; alt: string }
	> = {
		1: {
			title: 'Your shuttle is arriving shortly.',
			subtitle: '',
			image: '/arriving-screen.png',
			alt: 'Illustration of the shuttle approaching the pickup point'
		},
		2: {
			title: 'Your shuttle has arrived.',
			subtitle: 'Look for shuttle number 4',
			image: '/arrived-screen.png',
			alt: 'Illustration of shuttle number 4 at the pickup point'
		},
		3: {
			title: 'Hop on board!',
			subtitle: 'Look for shuttle number 4',
			image: '/hopon-screen.png',
			alt: 'Illustration inviting the participant to board shuttle number 4'
		},
		4: {
			title: 'Please choose any seat.',
			subtitle: '',
			image: '/findseat-screen.png',
			alt: 'Illustration of available seats inside the shuttle'
		}
	};

	let screen = $derived(screens[step]);
</script>

<section class="flex min-h-[calc(100dvh-5rem)] flex-col">
	<div class="grid w-full flex-1 content-start gap-6 pt-6">
		<div class="text-left">
			<h1 class="boarding-title">{screen.title}</h1>
			<div class="mt-5 border-b border-[var(--hairline)]"></div>
			{#if screen.subtitle}
				<p class="boarding-subtitle mt-3">{screen.subtitle}</p>
			{/if}
		</div>

		<img
			class="-mx-6 h-auto max-h-[64dvh] w-[calc(100%+3rem)] max-w-none object-contain"
			src={screen.image}
			alt={screen.alt}
		/>
	</div>
</section>

<style>
	.boarding-title {
		font-family: var(--font-display);
		font-size: 40px;
		font-weight: 700;
		line-height: 1;
		color: #14422e;
	}

	.boarding-subtitle {
		font-family: var(--font-display);
		font-size: 32px;
		font-weight: 200;
		line-height: 1.08;
		color: #14422e;
	}
</style>
