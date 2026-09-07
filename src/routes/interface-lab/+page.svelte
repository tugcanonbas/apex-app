<script lang="ts">
	import ParticipantRide from '$lib/components/ParticipantRide.svelte';
	import {
		conditionLabel,
		mapTriggerTags,
		phaseLabel,
		phases,
		type BlockState,
		type Condition,
		type MapTriggerTag,
		type RideRequestStatus,
		type ScenarioConfig,
		type SicBoardingStep,
		type StateResponse,
		type StudyMap,
		type StudyPhase,
		type StudySession
	} from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const nowIso = '2026-01-01T09:00:00.000Z';
	const previewNow = new Date(nowIso).getTime();

	let previewTimeSeconds = $state(0);
	let previewPhaseMode: 'auto' | 'manual' = $state('auto');
	let manualPhase: StudyPhase = $state('booking');
	let rideStatus: RideRequestStatus = $state('none');
	let selectedRideOptionId = $state('');
	let selectedMapId = $state('');
	let participantProgressPercent = $state(0);
	let activeTriggerTags: MapTriggerTag[] = $state([]);
	let isPlaying = $state(false);
	let playbackSpeed = $state(1);
	let sicBoardingStep: SicBoardingStep = $state(1);
	let showSicBoardingScreen = $state(false);

	const labPhases: StudyPhase[] = [...phases, 'arrival'];
	let maps = $derived(data.initialState.maps);
	let selectedMap = $derived(
		maps.find((map) => map.id === selectedMapId) ?? data.initialState.map ?? maps[0] ?? null
	);
	let scenario = $derived(data.defaultScenario);
	let sicBoardingStartSeconds = $derived(
		scenario.timings.near_arrival + scenario.arrivalCompletionBufferSeconds
	);
	let previewTotalSeconds = $derived(
		Math.max(scenario.durationSeconds, sicBoardingStartSeconds)
	);
	let activePhase = $derived(previewPhaseMode === 'auto' ? phaseForTime(previewTimeSeconds) : manualPhase);
	let staticPreviewSession = $derived(
		createPreviewSession('sic', activePhase, scenario, selectedMap, previewTimeSeconds)
	);
	let adaptivePreviewSession = $derived(
		createPreviewSession('aic', activePhase, scenario, selectedMap, previewTimeSeconds)
	);
	let selectedOption = $derived(
		scenario.rideOptions.find((option) => option.id === selectedRideOptionId) ??
			scenario.rideOptions[0]
	);
	let eventSummary = $derived(eventDecisionSummary(activePhase, activeTriggerTags));

	$effect(() => {
		if (selectedRideOptionId || scenario.rideOptions.length === 0) return;
		selectedRideOptionId = scenario.rideOptions[0].id;
	});

	$effect(() => {
		if (selectedMapId || maps.length === 0) return;
		selectedMapId = maps[0].id;
	});

	$effect(() => {
		if (previewPhaseMode === 'auto') manualPhase = activePhase;
	});

	$effect(() => {
		if (activePhase === 'booking' && rideStatus === 'assigned') rideStatus = 'selected';
		if (activePhase !== 'booking' && rideStatus === 'none') rideStatus = 'requested';
		if (['waiting', 'delay', 'near_arrival', 'arrival'].includes(activePhase)) {
			rideStatus = 'assigned';
		}
	});

	$effect(() => {
		if (activePhase === 'delay' && !activeTriggerTags.includes('delay_notice_shown')) {
			activeTriggerTags = [...activeTriggerTags, 'delay_notice_shown'];
		}
		if (
			activePhase === 'near_arrival' &&
			!activeTriggerTags.includes('shuttle_arriving_zone_enter')
		) {
			activeTriggerTags = [...activeTriggerTags, 'shuttle_arriving_zone_enter'];
		}
	});

	$effect(() => {
		if (!isPlaying || typeof window === 'undefined') return;
		const interval = window.setInterval(() => {
			previewTimeSeconds = Math.min(
				previewTotalSeconds,
				Math.round((previewTimeSeconds + playbackSpeed) * 10) / 10
			);
			if (previewTimeSeconds >= previewTotalSeconds) isPlaying = false;
		}, 1000);
		return () => window.clearInterval(interval);
	});

	function phaseForTime(seconds: number): StudyPhase {
		if (seconds >= sicBoardingStartSeconds) return 'arrival';
		if (seconds >= scenario.timings.near_arrival) return 'near_arrival';
		if (scenario.includeDelay && seconds >= scenario.timings.delay) return 'delay';
		if (seconds >= scenario.assignmentDurationSeconds) return 'waiting';
		return 'booking';
	}

	function createPreviewSession(
		condition: Condition,
		phase: StudyPhase,
		activeScenario: ScenarioConfig,
		map: StudyMap | null,
		elapsedSeconds: number
	): StudySession {
		const showBoardingOverride = phase === 'arrival' && showSicBoardingScreen;
		const displayPhase = phase === 'arrival' && !showBoardingOverride
			? 'near_arrival'
			: phase;
		const status = phase === 'arrival' ? 'completed' : 'running';
		const activeBlock: BlockState = {
			block: 1,
			condition,
			selectedRideOptionId,
			rideRequestStatus: normalizedRideStatusForPhase(displayPhase),
			startedAt: nowIso,
			selectedAt: selectedRideOptionId ? nowIso : undefined,
			requestedAt: ['requested', 'assigned'].includes(normalizedRideStatusForPhase(displayPhase))
				? nowIso
				: undefined,
			assignedAt: normalizedRideStatusForPhase(displayPhase) === 'assigned' ? nowIso : undefined,
			completedAt: status === 'completed' ? nowIso : undefined,
			events: []
		};
		return {
			sessionId: 'interface-lab-session',
			participantId: 'LAB-PREVIEW',
			conditionOrder: condition === 'sic' ? 'SIC_AIC' : 'AIC_SIC',
			activeBlock: 1,
			activeCondition: condition,
			phase: displayPhase,
			status,
			selectedMapId: map?.id ?? 'lab-map',
			mapLocked: true,
			scenario: activeScenario,
			automation: {
				elapsedBeforePauseSeconds: elapsedSeconds
			},
			locationOverride: {
				participantProgress: participantProgressPercent / 100,
				updatedAt: nowIso
			},
			sicBoardingStep: showBoardingOverride ? sicBoardingStep : undefined,
			activeTriggerTags,
			triggerZoneState: {},
			notes: 'Interface lab preview only. No study data is written.',
			technicalIssues: [],
			createdAt: nowIso,
			updatedAt: nowIso,
			blocks: [
				activeBlock,
				{
					block: 2,
					condition: condition === 'sic' ? 'aic' : 'sic',
					rideRequestStatus: 'none',
					events: []
				}
			],
			events: []
		};
	}

	function normalizedRideStatusForPhase(phase: StudyPhase): RideRequestStatus {
		if (['waiting', 'delay', 'near_arrival', 'arrival'].includes(phase)) return 'assigned';
		if (phase === 'assignment' && rideStatus === 'none') return 'requested';
		if (phase !== 'booking' && rideStatus === 'selected') return 'requested';
		return rideStatus;
	}

	function handlePreviewRideChange(optionId: string, status: RideRequestStatus) {
		selectedRideOptionId = optionId;
		rideStatus = status;
		if (status === 'requested') {
			previewPhaseMode = 'manual';
			manualPhase = 'assignment';
		}
	}

	function handleJumpPhase(phase: StudyPhase) {
		previewPhaseMode = 'manual';
		manualPhase = phase;
		previewTimeSeconds = elapsedForPhase(phase);
		showSicBoardingScreen = false;
	}

	function elapsedForPhase(phase: StudyPhase): number {
		if (phase === 'arrival') return sicBoardingStartSeconds;
		if (phase === 'near_arrival') return scenario.timings.near_arrival;
		if (phase === 'delay') return scenario.timings.delay;
		if (phase === 'waiting') return scenario.assignmentDurationSeconds;
		return 0;
	}

	function handleSicBoardingStep(step: SicBoardingStep) {
		sicBoardingStep = step;
		showSicBoardingScreen = true;
		previewPhaseMode = 'manual';
		manualPhase = 'arrival';
		previewTimeSeconds = sicBoardingStartSeconds;
		rideStatus = 'assigned';
	}

	function toggleTrigger(tag: MapTriggerTag) {
		activeTriggerTags = activeTriggerTags.includes(tag)
			? activeTriggerTags.filter((item) => item !== tag)
			: [...activeTriggerTags, tag];
	}

	function applyPreset(preset: 'clear' | 'route' | 'waiting' | 'delay' | 'approach' | 'boarding') {
		if (preset === 'clear') {
			activeTriggerTags = [];
			participantProgressPercent = 0;
			return;
		}
		if (preset === 'route') {
			activeTriggerTags = ['participant_route_start', 'participant_midroute_enter'];
			participantProgressPercent = 45;
			handleJumpPhase('waiting');
		}
		if (preset === 'waiting') {
			activeTriggerTags = ['pickup_zone_enter', 'participant_waiting_zone_enter'];
			participantProgressPercent = 100;
			handleJumpPhase('waiting');
		}
		if (preset === 'delay') {
			activeTriggerTags = ['pickup_zone_enter', 'participant_waiting_zone_enter', 'delay_notice_shown'];
			participantProgressPercent = 100;
			handleJumpPhase('delay');
		}
		if (preset === 'approach') {
			activeTriggerTags = [
				'pickup_zone_enter',
				'participant_waiting_zone_enter',
				'shuttle_arriving_zone_enter',
				'revised_eta_acknowledged'
			];
			participantProgressPercent = 100;
			handleJumpPhase('near_arrival');
		}
		if (preset === 'boarding') {
			activeTriggerTags = [
				'pickup_zone_enter',
				'participant_waiting_zone_enter',
				'shuttle_arriving_zone_enter',
				'boarding_zone_enter',
				'revised_eta_acknowledged'
			];
			participantProgressPercent = 100;
			handleSicBoardingStep(1);
		}
	}

	function eventDecisionSummary(phase: StudyPhase, tags: MapTriggerTag[]): string {
		if (phase === 'booking') return 'Booking compares the same ride facts; AIC foregrounds the suggested option.';
		if (phase === 'assignment') return 'Assignment hides vehicle details until assigned.';
		if (tags.includes('delay_notice_shown')) {
			return 'Delay state keeps pickup unchanged and foregrounds revised timing in AIC.';
		}
		if (tags.includes('shuttle_arriving_zone_enter')) {
			return 'Shuttle approach foregrounds vehicle identity and boarding preparation in AIC.';
		}
		if (tags.includes('pickup_zone_exit') || tags.includes('participant_waiting_zone_exit')) {
			return 'Leaving the pickup/waiting area asks the participant to return; SIC keeps it as plain status.';
		}
		if (tags.includes('pickup_zone_enter') || tags.includes('participant_waiting_zone_enter')) {
			return 'Pickup/waiting area reached confirms where to stay.';
		}
		if (tags.includes('participant_midroute_enter') || tags.includes('participant_route_start')) {
			return 'Route progress updates the path cue without adding new facts.';
		}
		return 'No adaptive trigger is active; only phase and ride-status state shape the preview.';
	}

	function formatSeconds(seconds: number): string {
		const total = Math.max(0, Math.round(seconds));
		const minutes = Math.floor(total / 60);
		const rest = total % 60;
		return `${minutes}:${rest.toString().padStart(2, '0')}`;
	}
</script>

<svelte:head>
	<title>VERDĒ Interface Lab</title>
</svelte:head>

<main class="min-h-dvh bg-canvas-mist text-forest">
	<header class="sticky top-0 z-20 border-b border-[var(--hairline)] bg-white/90 px-5 py-4 backdrop-blur-xl">
		<div class="mx-auto flex max-w-[1800px] flex-col gap-4">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<div>
					<p class="text-xs font-bold tracking-[0.24em] text-corduroy uppercase">VERDĒ</p>
					<h1 class="text-2xl font-bold">Interface Lab</h1>
				</div>
				<div class="flex flex-wrap gap-2">
					<a
						class="rounded-full border border-[var(--hairline)] bg-white px-4 py-2 text-sm font-bold"
						href="/dashboard">Dashboard</a
					>
					<a
						class="rounded-full border border-[var(--hairline)] bg-white px-4 py-2 text-sm font-bold"
						href="/app">Participant app</a
					>
				</div>
			</div>

			<section class="rounded-[28px] border border-[var(--hairline)] bg-canvas p-4 shadow-verde-soft">
				<div class="flex flex-wrap items-center justify-between gap-3">
					<div>
						<p class="text-sm font-bold">Block time</p>
						<p class="text-xs font-semibold text-corduroy">
							{formatSeconds(previewTimeSeconds)} of {formatSeconds(previewTotalSeconds)} ·
							{phaseLabel(activePhase)}
						</p>
					</div>
					<div class="flex flex-wrap gap-2">
						<button
							class="rounded-full bg-forest px-4 py-2 text-sm font-bold text-white"
							onclick={() => (isPlaying = !isPlaying)}
						>
							{isPlaying ? 'Pause' : 'Play'}
						</button>
						<button
							class="rounded-full border border-[var(--hairline)] bg-white px-4 py-2 text-sm font-bold"
							onclick={() => {
								isPlaying = false;
								previewTimeSeconds = 0;
								previewPhaseMode = 'auto';
								rideStatus = 'none';
								sicBoardingStep = 1;
								showSicBoardingScreen = false;
								activeTriggerTags = [];
								participantProgressPercent = 0;
							}}
						>
							Reset
						</button>
					</div>
				</div>
				<div class="relative mt-4">
					<input
						class="w-full accent-leaf"
						type="range"
						min="0"
						max={previewTotalSeconds}
						step="1"
						bind:value={previewTimeSeconds}
						oninput={() => {
							previewPhaseMode = 'auto';
							showSicBoardingScreen = false;
						}}
					/>
					<div class="mt-2 grid grid-cols-4 gap-2 text-[0.68rem] font-bold text-corduroy">
						<span>Assignment {formatSeconds(scenario.assignmentDurationSeconds)}</span>
						<span>Delay {formatSeconds(scenario.timings.delay)}</span>
						<span>Handoff {formatSeconds(scenario.timings.near_arrival)}</span>
						<span>Boarding {formatSeconds(sicBoardingStartSeconds)}</span>
					</div>
				</div>
			</section>
		</div>
	</header>

	<div class="mx-auto grid max-w-[1860px] gap-4 px-5 py-5 2xl:grid-cols-[260px_minmax(936px,1fr)_280px]">
		<aside class="grid content-start gap-4">
			<section class="verde-card p-4">
				<div class="flex items-center justify-between gap-3">
					<h2 class="text-lg font-bold">Preview setup</h2>
					<span class="rounded-full bg-mint px-3 py-1 text-xs font-bold">
						{previewPhaseMode === 'auto' ? 'Auto time' : 'Manual phase'}
					</span>
				</div>
				<div class="mt-4 grid gap-3">
					<label class="grid gap-1 text-sm font-bold">
						Map
						<select class="rounded-2xl border border-[var(--hairline)] bg-white px-3 py-3" bind:value={selectedMapId}>
							{#each maps as map}
								<option value={map.id}>{map.name}</option>
							{/each}
						</select>
					</label>
					<label class="grid gap-1 text-sm font-bold">
						Ride option
						<select class="rounded-2xl border border-[var(--hairline)] bg-white px-3 py-3" bind:value={selectedRideOptionId}>
							{#each scenario.rideOptions as option}
								<option value={option.id}>{option.label} · {option.pickupPoint}</option>
							{/each}
						</select>
					</label>
					<label class="grid gap-1 text-sm font-bold">
						Ride status
						<select class="rounded-2xl border border-[var(--hairline)] bg-white px-3 py-3" bind:value={rideStatus}>
							<option value="none">None</option>
							<option value="selected">Selected</option>
							<option value="requested">Requested</option>
							<option value="assigned">Assigned</option>
						</select>
					</label>
					<div class="rounded-2xl bg-mint/45 px-4 py-3 text-sm font-bold">
						Both condition previews are interactive and share this setup state.
					</div>
				</div>
			</section>

			<section class="verde-card p-4">
				<h2 class="text-lg font-bold">Phase jump</h2>
				<div class="mt-3 grid grid-cols-2 gap-2">
					{#each labPhases as phase}
						<button
							class="rounded-full border px-3 py-2 text-xs font-bold"
							class:border-leaf={phase === activePhase}
							class:bg-mint={phase === activePhase}
							class:border-[var(--hairline)]={phase !== activePhase}
							class:bg-white={phase !== activePhase}
							onclick={() => handleJumpPhase(phase)}
						>
							{phaseLabel(phase)}
						</button>
					{/each}
				</div>
				<button
					class="mt-3 w-full rounded-full border border-[var(--hairline)] bg-white px-4 py-2 text-sm font-bold"
					onclick={() => (previewPhaseMode = 'auto')}
				>
					Return to slider phase
				</button>
			</section>

			<section class="verde-card p-4">
				<h2 class="text-lg font-bold">SIC boarding screens</h2>
				<p class="mt-1 text-sm leading-5 text-corduroy">
					Preview the post-near-arrival image sequence in the static condition.
				</p>
				<div class="mt-3 grid grid-cols-2 gap-2">
					<button
						class="rounded-full border px-3 py-2 text-xs font-bold"
						class:border-leaf={activePhase === 'arrival' && sicBoardingStep === 1}
						class:bg-mint={activePhase === 'arrival' && sicBoardingStep === 1}
						class:border-[var(--hairline)]={activePhase !== 'arrival' || sicBoardingStep !== 1}
						class:bg-white={activePhase !== 'arrival' || sicBoardingStep !== 1}
						onclick={() => handleSicBoardingStep(1)}
					>
						1. Arriving
					</button>
					<button
						class="rounded-full border px-3 py-2 text-xs font-bold"
						class:border-leaf={activePhase === 'arrival' && sicBoardingStep === 2}
						class:bg-mint={activePhase === 'arrival' && sicBoardingStep === 2}
						class:border-[var(--hairline)]={activePhase !== 'arrival' || sicBoardingStep !== 2}
						class:bg-white={activePhase !== 'arrival' || sicBoardingStep !== 2}
						onclick={() => handleSicBoardingStep(2)}
					>
						2. Arrived
					</button>
					<button
						class="rounded-full border px-3 py-2 text-xs font-bold"
						class:border-leaf={activePhase === 'arrival' && sicBoardingStep === 3}
						class:bg-mint={activePhase === 'arrival' && sicBoardingStep === 3}
						class:border-[var(--hairline)]={activePhase !== 'arrival' || sicBoardingStep !== 3}
						class:bg-white={activePhase !== 'arrival' || sicBoardingStep !== 3}
						onclick={() => handleSicBoardingStep(3)}
					>
						3. Hop on
					</button>
					<button
						class="rounded-full border px-3 py-2 text-xs font-bold"
						class:border-leaf={activePhase === 'arrival' && sicBoardingStep === 4}
						class:bg-mint={activePhase === 'arrival' && sicBoardingStep === 4}
						class:border-[var(--hairline)]={activePhase !== 'arrival' || sicBoardingStep !== 4}
						class:bg-white={activePhase !== 'arrival' || sicBoardingStep !== 4}
						onclick={() => handleSicBoardingStep(4)}
					>
						4. Seat
					</button>
				</div>
			</section>

			<section class="verde-card p-4">
				<h2 class="text-lg font-bold">Current location</h2>
				<p class="mt-1 text-sm leading-5 text-corduroy">
					WOZ walking progress for the participant marker.
				</p>
				<input
					class="mt-4 w-full accent-leaf"
					type="range"
					min="0"
					max="100"
					step="1"
					bind:value={participantProgressPercent}
				/>
				<p class="mt-2 text-sm font-bold">{participantProgressPercent}% along path</p>
			</section>
		</aside>

		<section class="min-w-0 overflow-x-auto px-5 py-4 pb-8">
			<div class="preview-canvas mx-auto grid w-max grid-cols-[440px_440px] justify-center gap-8">
				<div class="preview-column">
					<div class="mb-2 flex items-center justify-between gap-3">
						<p class="text-sm font-bold">{conditionLabel('sic')}</p>
						<span class="rounded-full bg-white px-3 py-1 text-xs font-bold text-corduroy">
							{phaseLabel(activePhase)}
						</span>
					</div>
					<div class="phone-frame">
						<ParticipantRide
							session={staticPreviewSession}
							map={selectedMap}
							previewCondition="sic"
							previewCompact
							previewNow={previewNow}
							onTrackedTap={() => undefined}
							onRideOptionChange={handlePreviewRideChange}
						/>
					</div>
				</div>
				<div class="preview-column">
					<div class="mb-2 flex items-center justify-between gap-3">
						<p class="text-sm font-bold">{conditionLabel('aic')}</p>
						<span class="rounded-full bg-mint px-3 py-1 text-xs font-bold text-forest">
							{phaseLabel(activePhase)}
						</span>
					</div>
					<div class="phone-frame">
						<ParticipantRide
							session={adaptivePreviewSession}
							map={selectedMap}
							previewCondition="aic"
							previewCompact
							previewNow={previewNow}
							onTrackedTap={() => undefined}
							onRideOptionChange={handlePreviewRideChange}
						/>
					</div>
				</div>
			</div>
		</section>

		<aside class="grid content-start gap-4">
			<section class="verde-card p-4">
				<h2 class="text-lg font-bold">Event presets</h2>
				<p class="mt-1 text-sm leading-5 text-corduroy">{eventSummary}</p>
				<div class="mt-4 grid grid-cols-2 gap-2">
					<button class="preset-button" onclick={() => applyPreset('clear')}>Clear</button>
					<button class="preset-button" onclick={() => applyPreset('route')}>Mid-route</button>
					<button class="preset-button" onclick={() => applyPreset('waiting')}>At pickup</button>
					<button class="preset-button" onclick={() => applyPreset('delay')}>Delay</button>
					<button class="preset-button" onclick={() => applyPreset('approach')}>Approach</button>
					<button class="preset-button" onclick={() => applyPreset('boarding')}>Boarding</button>
				</div>
			</section>

			<section class="verde-card p-4">
				<h2 class="text-lg font-bold">Triggers</h2>
				<div class="mt-3 grid gap-2">
					{#each mapTriggerTags as trigger}
						<label
							class="grid cursor-pointer grid-cols-[auto_1fr] gap-3 rounded-2xl border px-3 py-3"
							class:border-leaf={activeTriggerTags.includes(trigger.tag)}
							class:bg-mint={activeTriggerTags.includes(trigger.tag)}
							class:border-[var(--hairline)]={!activeTriggerTags.includes(trigger.tag)}
							class:bg-white={!activeTriggerTags.includes(trigger.tag)}
						>
							<input
								class="mt-1"
								type="checkbox"
								checked={activeTriggerTags.includes(trigger.tag)}
								onchange={() => toggleTrigger(trigger.tag)}
							/>
							<span>
								<span class="block text-sm font-bold">{trigger.label}</span>
								<span class="block pt-1 text-xs leading-5 text-corduroy">{trigger.description}</span>
							</span>
						</label>
					{/each}
				</div>
			</section>

			<section class="verde-card p-4">
				<h2 class="text-lg font-bold">Current facts</h2>
				<div class="mt-3 grid gap-2 text-sm font-semibold text-[#263C34]">
					<p class="rounded-2xl bg-canvas-mist px-3 py-2">Option: {selectedOption?.label}</p>
					<p class="rounded-2xl bg-canvas-mist px-3 py-2">Pickup: {selectedOption?.pickupPoint}</p>
					<p class="rounded-2xl bg-canvas-mist px-3 py-2">Vehicle: {selectedOption?.vehicleId}</p>
					<p class="rounded-2xl bg-canvas-mist px-3 py-2">
						Active triggers: {activeTriggerTags.length}
					</p>
				</div>
			</section>
		</aside>
	</div>
</main>

<style>
	.preview-column {
		width: 440px;
	}

	.phone-frame {
		height: 956px;
		width: 440px;
		overflow-y: auto;
		overflow-x: hidden;
		overscroll-behavior: contain;
		-webkit-overflow-scrolling: touch;
		border: 1px solid var(--hairline);
		border-radius: 42px;
		background: #f6faf8;
		box-shadow:
			0 0 0 10px #111,
			0 24px 70px rgba(20, 66, 46, 0.22);
	}

	.phone-frame :global(.preview-device) {
		overflow: visible;
	}

	.preset-button {
		border: 1px solid var(--hairline);
		border-radius: 999px;
		background: #ffffff;
		padding: 0.65rem 0.85rem;
		font-size: 0.8125rem;
		font-weight: 800;
		color: #14422e;
	}
</style>
