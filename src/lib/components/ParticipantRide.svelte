<script lang="ts">
	import AppShell from '$lib/components/participant/AppShell.svelte';
	import BoardingChecklist from '$lib/components/participant/BoardingChecklist.svelte';
	import BookingOptions from '$lib/components/participant/BookingOptions.svelte';
	import CompletionBridge from '$lib/components/participant/CompletionBridge.svelte';
	import FullMapOverlay from '$lib/components/participant/FullMapOverlay.svelte';
	import MetricStack from '$lib/components/participant/MetricStack.svelte';
	import RideStatusSection from '$lib/components/participant/RideStatusSection.svelte';
	import RouteApproachPanel from '$lib/components/participant/RouteApproachPanel.svelte';
	import SicBoardingScreen from '$lib/components/participant/SicBoardingScreen.svelte';
	import StatusUpdate from '$lib/components/participant/StatusUpdate.svelte';
	import VehicleCard from '$lib/components/participant/VehicleCard.svelte';
	import VehicleDetailsSheet from '$lib/components/participant/VehicleDetailsSheet.svelte';
	import ETAInfoModal from '$lib/components/participant/ETAInfoModal.svelte';
	import defaultMap from '../../../data/maps/default-map.json';
	import option1Map from '../../../data/maps/option-1-map.json';
	import option2Map from '../../../data/maps/option-2-map.json';
	import zoomOutMap from '../../../data/maps/zoom-out-map.json';
	import type {
		MapTriggerTag,
		RideOption,
		RideRequestStatus,
		RouteMapInteractionPayload,
		RouteMapViewState,
		StudyMap,
		StudyPhase,
		StudySession
	} from '$lib/types';
	import {
		journeySteps,
		type BookingOptionView,
		type DetailContent,
		type DetailItem,
		type DetailTopic,
		type IconName,
		type JourneyStepState,
		type MetricItem,
		type RouteGuideContent,
		type RideModule,
		type TriggerDecision
	} from '$lib/components/participant/rideTypes';

	let {
		session,
		map,
		previewCondition,
		previewCompact = false,
		previewNow,
		onTrackedTap = () => undefined,
		onRideOptionChange = () => undefined
	}: {
		session: StudySession;
		map: StudyMap | null;
		previewCondition?: 'sic' | 'aic';
		previewCompact?: boolean;
		previewNow?: number;
		onTrackedTap?: (target: string, payload?: Record<string, unknown>) => void;
		onRideOptionChange?: (
			optionId: string,
			status: RideRequestStatus,
			metadata?: Record<string, unknown>
		) => void | Promise<void>;
	} = $props();

	type OpenDetailState = {
		topic: DetailTopic;
		source: string;
		openedAt: number;
		phase: StudyPhase;
		condition: 'sic' | 'aic';
		selectedRideOptionId?: string;
		scrollDepth: number;
	};
	type OpenMapState = {
		source: string;
		openedAt: number;
		phase: StudyPhase;
		condition: 'sic' | 'aic';
		selectedRideOptionId?: string;
	};
	type OpenSimpleSheetState = {
		source: string;
		openedAt: number;
		phase: StudyPhase;
		condition: 'sic' | 'aic';
		selectedRideOptionId?: string;
	};
	let clientNow = $state(Date.now());
	let isFullMapOpen = $state(false);
	let isVehicleDetailsOpen = $state(false);
	let isEtaModalOpen = $state(false);
	let routeMapViewState = $state<RouteMapViewState | null>(null);
	let activeDetailTopic: DetailTopic | null = $state(null);
	let openDetailState: OpenDetailState | null = null;
	let openMapState: OpenMapState | null = null;
	let openVehicleState: OpenSimpleSheetState | null = null;
	let openEtaState: OpenSimpleSheetState | null = null;

	let condition = $derived(previewCondition ?? session.activeCondition);
	let isAdaptive = $derived(condition === 'aic');
	let isSicBoardingScreen = $derived(
		session.phase === 'arrival' && Boolean(session.sicBoardingStep)
	);
	let activeBlock = $derived(session.blocks.find((block) => block.block === session.activeBlock));
	let rideStatus = $derived(activeBlock?.rideRequestStatus ?? 'none');
	let rideOptions = $derived(session.scenario.rideOptions);
	let recommendedOption = $derived(
		rideOptions.find((option) => option.isRecommended) ?? rideOptions[0]
	);
	let selectedOption = $derived(
		rideOptions.find((option) => option.id === activeBlock?.selectedRideOptionId)
	);
	let assignmentFallbackOption = $derived(
		rideOptions.find((option) => option.id === activeBlock?.assignmentFallbackFromOptionId)
	);
	let focusOption = $derived(selectedOption ?? recommendedOption);
	let hasSelection = $derived(rideStatus === 'selected' && Boolean(selectedOption));
	let hasRequestedRide = $derived(rideStatus === 'requested' || rideStatus === 'assigned');
	let isVehicleAssigned = $derived(rideStatus === 'assigned');
	let optionOrder = $derived(
		isAdaptive && recommendedOption
			? [recommendedOption, ...rideOptions.filter((option) => option.id !== recommendedOption.id)]
			: rideOptions
	);
	let optionViews = $derived(bookingOptionViews());
	let flowOrder = $derived(moduleOrder(session.phase));
	let progressPercent = $derived(blockProgressPercent());
	let renderNow = $derived(previewNow ?? clientNow);
	let stepViews = $derived(journeyStepStates());
	let metrics = $derived(metricItems());
	const sicBookingMap = zoomOutMap as StudyMap;
	const directPickupMap = defaultMap as StudyMap;
	const shelteredPickupMap = option1Map as StudyMap;
	const sharedLoopMap = option2Map as StudyMap;

	$effect(() => {
		if (typeof window === 'undefined' || previewNow !== undefined) return;
		const interval = window.setInterval(() => {
			clientNow = Date.now();
		}, 1000);
		return () => window.clearInterval(interval);
	});

	function copy(key: StudyPhase | 'ready' | 'offline' | 'block_finished' | 'study_finished') {
		return session.scenario.phaseCopy[key] ?? session.scenario.phaseCopy.booking;
	}

	function formatClock(seconds: number): string {
		const minutes = Math.floor(seconds / 60);
		const rest = seconds % 60;
		return `${minutes}:${rest.toString().padStart(2, '0')}`;
	}

	function formatClockTime(timestamp: number): string {
		const date = new Date(timestamp);
		const hours = date.getHours().toString().padStart(2, '0');
		const minutes = date.getMinutes().toString().padStart(2, '0');
		return `${hours}:${minutes}`;
	}

	function scenarioElapsedSeconds(): number {
		const startedAt = session.automation.startedAt
			? new Date(session.automation.startedAt).getTime()
			: undefined;
		return startedAt
			? Math.max(
					0,
					Math.floor((renderNow - startedAt) / 1000) + session.automation.elapsedBeforePauseSeconds
				)
			: session.automation.elapsedBeforePauseSeconds;
	}

	function minutesFromSeconds(seconds: number): number {
		return Math.max(1, Math.ceil(Math.max(0, seconds) / 60));
	}

	function pickupArrivalSeconds(): number {
		return Math.max(0, session.scenario.timings.arrival);
	}

	function initialPickupSeconds(): number {
		return Math.max(0, session.scenario.initialEtaSeconds || session.scenario.timings.arrival);
	}

	function revisedPickupSeconds(): number {
		return Math.max(0, session.scenario.revisedEtaSeconds || session.scenario.timings.arrival);
	}

	function effectiveFinalPickupSeconds(): number {
		if (!session.scenario.includeDelay) return pickupArrivalSeconds();
		return Math.max(
			pickupArrivalSeconds(),
			session.scenario.timings.delay + revisedPickupSeconds()
		);
	}

	function remainingPickupSeconds(): number {
		const elapsed = scenarioElapsedSeconds();
		if (
			session.scenario.includeDelay &&
			['delay', 'near_arrival', 'arrival'].includes(session.phase)
		) {
			return Math.max(0, effectiveFinalPickupSeconds() - elapsed);
		}
		return Math.max(0, initialPickupSeconds() - elapsed);
	}

	function shuttleProgressForTiming(): number {
		if (session.phase === 'booking') return 0;
		const arrivalSeconds = effectiveFinalPickupSeconds();
		if (arrivalSeconds <= 0) return 1;
		return Math.min(1, Math.max(0, scenarioElapsedSeconds() / arrivalSeconds));
	}

	function basePickupEtaMinutes(): number {
		return minutesFromSeconds(initialPickupSeconds());
	}

	function optionWaitMinutes(option: RideOption | undefined): number {
		if (!option) return basePickupEtaMinutes();
		const minimumOptionWait = Math.min(...rideOptions.map((item) => item.waitMinutes));
		return Math.max(1, basePickupEtaMinutes() + option.waitMinutes - minimumOptionWait);
	}

	function optionWaitSeconds(option: RideOption | undefined): number {
		if (!option) return initialPickupSeconds();
		const minimumOptionWait = Math.min(...rideOptions.map((item) => item.waitMinutes));
		const optionOffsetSeconds = Math.max(0, option.waitMinutes - minimumOptionWait) * 60;
		return initialPickupSeconds() + optionOffsetSeconds;
	}

	function optionArrivalTime(option: RideOption | undefined): string {
		if (!option) return formatClockTime(renderNow);
		return formatClockTime(
			renderNow + (optionWaitSeconds(option) + option.rideMinutes * 60) * 1000
		);
	}

	function mapForRideOption(option: RideOption | undefined): StudyMap | null {
		if (option?.id === 'verde-sheltered' || option?.label === 'Sheltered pickup') {
			return shelteredPickupMap;
		}
		if (option?.id === 'verde-shared' || option?.label === 'Shared campus loop') {
			return sharedLoopMap;
		}
		if (option?.id === 'verde-direct' || option?.label === 'Direct pickup') return directPickupMap;
		return map;
	}

	function rideArrivalTime(): string {
		if (!focusOption) return formatClockTime(renderNow);
		const pickupSeconds =
			session.phase === 'booking'
				? optionWaitSeconds(focusOption)
				: session.phase === 'arrival'
					? 0
					: remainingPickupSeconds();
		const rideSeconds =
			session.phase === 'arrival'
				? session.scenario.rideEtaAfterArrivalMinutes * 60
				: focusOption.rideMinutes * 60;
		return formatClockTime(renderNow + (pickupSeconds + rideSeconds) * 1000);
	}

	function etaMinutes(phase: StudyPhase): number {
		if (phase === 'arrival') return session.scenario.rideEtaAfterArrivalMinutes;
		if (phase === 'booking') return optionWaitMinutes(focusOption);
		return minutesFromSeconds(remainingPickupSeconds());
	}

	function originalEtaMinutes(): number {
		return basePickupEtaMinutes();
	}

	function initialRemainingAtDelaySeconds(): number {
		if (!session.scenario.includeDelay) return initialPickupSeconds();
		return Math.max(0, initialPickupSeconds() - session.scenario.timings.delay);
	}

	function originalRemainingAtDelayMinutes(): number {
		return minutesFromSeconds(initialRemainingAtDelaySeconds());
	}

	function bookingEtaOption(): RideOption | undefined {
		return assignmentFallbackOption ?? selectedOption ?? focusOption;
	}

	function etaModalInitialMinutes(): number {
		return optionWaitMinutes(bookingEtaOption());
	}

	function etaModalUpdatedMinutes(): number {
		if (session.phase === 'delay') return etaMinutes('delay');
		return etaMinutes(session.phase);
	}

	function etaModalChangeMinutes(): number {
		if (!session.scenario.includeDelay || session.phase !== 'delay') return 0;
		return etaModalUpdatedMinutes() - etaModalInitialMinutes();
	}

	function etaModalChangeLabel(): string {
		const change = etaModalChangeMinutes();
		if (change === 0) return '';
		return `${change > 0 ? '+' : ''}${change} min`;
	}

	function hasDelayUpdate(): boolean {
		return (
			session.scenario.includeDelay && ['delay', 'near_arrival', 'arrival'].includes(session.phase)
		);
	}

	function delayDurationChangeMinutes(): number {
		if (!session.scenario.includeDelay) return 0;
		return Math.max(
			0,
			minutesFromSeconds(revisedPickupSeconds()) - originalRemainingAtDelayMinutes()
		);
	}

	function co2DelayChangeKg(): number {
		if (!hasDelayUpdate()) return 0;
		return Number((delayDurationChangeMinutes() * 0.1).toFixed(1));
	}

	function co2SavedKg(option: RideOption | undefined, includeDelayUpdate = true): number {
		const base = option?.co2SavedKg ?? 0;
		return Number((base + (includeDelayUpdate ? co2DelayChangeKg() : 0)).toFixed(1));
	}

	function co2ChangeLabel(): string {
		const change = co2DelayChangeKg();
		if (change <= 0) return '';
		return `+${change.toFixed(1)} kg`;
	}

	function blockProgressPercent(): number {
		if (session.phase === 'booking') return 0;
		return Math.min(
			100,
			Math.round((scenarioElapsedSeconds() / session.scenario.durationSeconds) * 100)
		);
	}

	function moduleOrder(phase: StudyPhase): RideModule[] {
		if (!isAdaptive) {
			return ['hero', 'map', 'guidance', 'pickup', 'vehicle', 'timeline'];
		}
		if (phase === 'assignment')
			return assignmentVehicleFocusActive()
				? ['vehicle', 'guidance', 'map', 'pickup', 'timeline']
				: ['hero', 'guidance', 'vehicle', 'pickup', 'map', 'timeline'];
		if (phase === 'waiting') return ['hero', 'map', 'guidance', 'pickup', 'timeline', 'vehicle'];
		if (phase === 'delay') return ['guidance', 'hero', 'map', 'vehicle', 'pickup', 'timeline'];
		if (phase === 'near_arrival')
			return ['guidance', 'hero', 'vehicle', 'pickup', 'map', 'timeline'];
		if (phase === 'arrival') return ['hero', 'vehicle', 'map', 'guidance', 'timeline'];
		return ['hero', 'map', 'guidance', 'pickup', 'vehicle', 'timeline'];
	}

	function guidanceTitle(phase: StudyPhase): string {
		const decision = activeTriggerDecision();
		if (decision) {
			if (isAdaptive) {
				if (decision.tone === 'route') return 'Route guidance';
				if (decision.tone === 'delay') return 'Timing update';
				if (decision.tone === 'boarding') return 'Vehicle check';
				if (decision.tone === 'arrival') return 'Shuttle approach';
				return 'Pickup guidance';
			}
			return decision.sicTitle;
		}
		if (phase === 'assignment')
			return rideStatus === 'assigned' ? 'Shuttle confirmed' : 'Finding shuttle';
		if (phase === 'waiting') return 'Go to pickup';
		if (phase === 'delay') return 'Timing changed';
		if (phase === 'near_arrival') return 'Shuttle approaching';
		if (phase === 'arrival') return isAdaptive ? 'Shuttle here' : 'Shuttle arriving';
		return 'Next step';
	}

	function assignedVehicleLabel(): string {
		return isVehicleAssigned
			? (focusOption?.vehicleId ?? 'the assigned shuttle')
			: 'the assigned shuttle';
	}

	function assignmentVehicleFocusActive(): boolean {
		if (
			!isAdaptive ||
			session.phase !== 'assignment' ||
			!isVehicleAssigned ||
			!activeBlock?.assignedAt
		) {
			return false;
		}
		return renderNow - new Date(activeBlock.assignedAt).getTime() < 5000;
	}

	function guidanceBody(phase: StudyPhase): string {
		const decision = activeTriggerDecision();
		if (decision) return decision.body;
		if (phase === 'assignment') {
			return isVehicleAssigned
				? `${focusOption?.vehicleId} is assigned to ${focusOption?.pickupPoint}.`
				: `VERDĒ is matching your ride to ${focusOption?.pickupPoint}.`;
		}
		if (phase === 'waiting') return `Walk to ${focusOption?.pickupPoint}. Pickup has not changed.`;
		if (phase === 'delay') {
			return `Pickup is now about ${etaMinutes('delay')} min. It was ${originalRemainingAtDelayMinutes()} min when timing changed.`;
		}
		if (phase === 'near_arrival')
			return `Look for ${assignedVehicleLabel()}. Check the number when it stops.`;
		if (phase === 'arrival')
			return isAdaptive
				? `Match ${assignedVehicleLabel()} before you continue.`
				: `${assignedVehicleLabel()} is arriving. Check the shuttle number.`;
		return copy(phase).body;
	}

	function phaseHeadline(phase: StudyPhase): string {
		const decision = activeTriggerDecision();
		if (isAdaptive && phase === 'waiting' && decision) {
			if (decision.tone === 'route') return 'Route guidance';
			if (decision.tone === 'delay') return 'Timing update';
			if (decision.tone === 'boarding') return 'Vehicle check';
			if (decision.tone === 'arrival') return 'Shuttle approach';
			return 'Pickup guidance';
		}
		if (phase === 'assignment') return isVehicleAssigned ? 'Shuttle confirmed' : 'Request received';
		if (phase === 'waiting')
			return isAdaptive ? 'Go to pickup' : `${etaMinutes(phase)} min until pickup`;
		if (phase === 'delay') return isAdaptive ? 'Timing changed' : 'Timing update';
		if (phase === 'near_arrival')
			return isAdaptive
				? `Shuttle approaching ${focusOption?.pickupPoint ?? 'pickup'}`
				: 'Shuttle approaching';
		if (phase === 'arrival')
			return isAdaptive ? `${assignedVehicleLabel()} is here` : 'Shuttle arriving';
		return copy(phase).title;
	}

	function phaseHeroBody(phase: StudyPhase): string {
		if (phase === 'assignment') {
			if (isVehicleAssigned)
				return `${focusOption?.pickupPoint}. Pickup in ${etaMinutes(phase)} min.`;
			return 'VERDĒ is finding your shuttle.';
		}
		if (phase === 'waiting') {
			return isAdaptive
				? `Go to ${focusOption?.pickupPoint}. The route stays visible.`
				: 'Pickup unchanged.';
		}
		if (phase === 'delay') {
			return isAdaptive
				? `Use the updated ETA. Pickup stays at ${focusOption?.pickupPoint}.`
				: `Pickup is now about ${etaMinutes(phase)} min. Stop: ${focusOption?.pickupPoint}.`;
		}
		if (phase === 'near_arrival') {
			return isAdaptive
				? `${assignedVehicleLabel()} is approaching ${focusOption?.pickupPoint}.`
				: `At ${focusOption?.pickupPoint}.`;
		}
		if (phase === 'arrival')
			return isAdaptive
				? `Match ${assignedVehicleLabel()} before you continue.`
				: `${assignedVehicleLabel()} is arriving. Check the shuttle number.`;
		return copy(phase).body;
	}

	function pickupEtaLabel(): string {
		if (session.phase === 'near_arrival' || session.phase === 'arrival') return 'Now';
		return `${etaMinutes(session.phase)} min`;
	}

	function pickupEtaCaption(): string {
		if (session.phase === 'near_arrival' || session.phase === 'arrival') return 'Pickup';
		return 'ETA';
	}

	function etaChangeMinutes(): number {
		if (!session.scenario.includeDelay || session.phase !== 'delay') return 0;
		return etaModalChangeMinutes();
	}

	function etaChangeLabel(): string {
		const change = etaChangeMinutes();
		if (change === 0) return '';
		return `${change > 0 ? '+' : ''}${change} min`;
	}

	function etaTone(): 'neutral' | 'early' | 'delay' {
		if (!isAdaptive) return 'neutral';
		const change = etaChangeMinutes();
		if (change > 0) return 'delay';
		if (change < 0) return 'early';
		return 'neutral';
	}

	function screenHeadline(): string {
		if (!isAdaptive) return 'Waiting for pickup';
		const decision = activeTriggerDecision();
		if (decision) {
			if (decision.tone === 'route') return 'Route guidance';
			if (decision.tone === 'delay') return 'Timing changed';
			if (decision.tone === 'boarding') return 'Vehicle check';
			if (decision.tone === 'arrival') return 'Shuttle approaching';
			return 'Pickup guidance';
		}
		if (session.phase === 'assignment') {
			if (assignmentFallbackOption && !isVehicleAssigned) return 'Direct pickup setup';
			if (assignmentFallbackOption) return 'Direct pickup confirmed';
			if (!isVehicleAssigned) return 'Finding your shuttle';
			return `${focusOption?.label ?? 'Ride'} ready`;
		}
		if (session.phase === 'waiting') return 'Go to pickup';
		if (session.phase === 'delay') return 'Timing changed';
		if (session.phase === 'near_arrival') return 'Shuttle approaching';
		if (session.phase === 'arrival') return 'Shuttle here';
		return 'Waiting for pickup';
	}

	function selectedNonDirect(): boolean {
		return Boolean(focusOption && focusOption.id !== 'verde-direct');
	}

	function statusUpdateTone(): 'neutral' | 'route' | 'wait' | 'delay' | 'boarding' | 'arrival' {
		if (!isAdaptive) return 'neutral';
		const decision = activeTriggerDecision();
		if (decision) return decision.tone;
		if (session.phase === 'delay') return 'delay';
		if (session.phase === 'waiting') return 'route';
		if (session.phase === 'near_arrival') return 'arrival';
		if (session.phase === 'arrival') return 'boarding';
		return 'wait';
	}

	function statusUpdateIcon(): IconName {
		const tone = activeTriggerDecision()?.tone ?? statusUpdateTone();
		if (tone === 'delay') return 'alert';
		if (tone === 'boarding') return 'shield';
		if (tone === 'arrival') return 'vehicle';
		if (tone === 'route') return 'navigation';
		return 'progress';
	}

	function statusUpdateTitle(): string {
		const decision = activeTriggerDecision();
		if (decision) {
			if (!isAdaptive) return decision.sicTitle;
			if (decision.tone === 'route') return 'Route note';
			if (decision.tone === 'delay') return 'Timing note';
			if (decision.tone === 'boarding') return 'Vehicle note';
			if (decision.tone === 'arrival') return 'Approach note';
			return 'Pickup note';
		}
		if (session.phase === 'assignment') {
			if (assignmentFallbackOption && !isVehicleAssigned) return 'Direct pickup setup';
			if (assignmentFallbackOption) return 'Pickup confirmed';
			if (!isVehicleAssigned) return 'Finding shuttle';
			return selectedNonDirect() ? 'Pickup assigned' : 'Direct pickup assigned';
		}
		if (session.phase === 'waiting') return 'Pickup reminder';
		if (session.phase === 'delay') return 'Timing update';
		if (session.phase === 'near_arrival') return 'Shuttle watch';
		if (session.phase === 'arrival') return 'Vehicle check';
		return 'Ride status';
	}

	function statusUpdateBody(): string {
		const decision = activeTriggerDecision();
		if (decision) return decision.body;
		if (!isAdaptive) {
			if (session.phase === 'assignment' && assignmentFallbackOption) {
				return isVehicleAssigned
					? `${assignmentFallbackOption.label} was checked. Direct pickup keeps the route steady.`
					: `${assignmentFallbackOption.label} is being checked. Direct pickup keeps the route steady.`;
			}
			if (session.phase === 'assignment') {
				return 'VERDĒ is confirming the shuttle and route. Vehicle details appear after assignment.';
			}
			return 'Current ETA and route are shown. Follow the route and wait at pickup.';
		}
		if (session.phase === 'assignment') {
			if (assignmentFallbackOption) {
				return isVehicleAssigned
					? `You selected ${assignmentFallbackOption.label}. Direct pickup keeps this route steady.`
					: `You selected ${assignmentFallbackOption.label}. VERDĒ is setting Direct pickup for a clearer route.`;
			}
			if (!isVehicleAssigned) {
				return selectedNonDirect()
					? `VERDĒ is matching your pickup with a shuttle. Vehicle details appear after assignment.`
					: `VERDĒ is confirming ${focusOption?.pickupPoint}, route, and vehicle.`;
			}
			return selectedNonDirect()
				? `${focusOption?.label} is assigned. Follow the route to ${focusOption?.pickupPoint}.`
				: `${assignedVehicleLabel()} is assigned to ${focusOption?.pickupPoint}.`;
		}
		if (session.phase === 'waiting') {
			return isAdaptive
				? `Go to ${focusOption?.pickupPoint}. The route stays visible.`
				: `Walk to ${focusOption?.pickupPoint}. The route stays visible.`;
		}
		if (session.phase === 'delay') {
			const change = etaChangeLabel();
			return isAdaptive
				? `Pickup changed${change ? ` by ${change.replace('+', '')}` : ''}. The stop stays the same.`
				: `Pickup is delayed${change ? ` by ${change.replace('+', '')}` : ''}. Use the ETA above.`;
		}
		if (session.phase === 'near_arrival') {
			return isAdaptive
				? `${assignedVehicleLabel()} is approaching ${focusOption?.pickupPoint}. Check the number when it stops.`
				: `${assignedVehicleLabel()} is approaching. Check the shuttle number at pickup.`;
		}
		if (session.phase === 'arrival') {
			return 'Your shuttle is at the pickup point. Keep this screen ready.';
		}
		return copy(session.phase).body;
	}

	function bookingMapForOption(option: RideOption | undefined): StudyMap {
		if (!isAdaptive) return sicBookingMap;
		if (option?.id === 'verde-sheltered' || option?.label === 'Sheltered pickup') {
			return shelteredPickupMap;
		}
		if (option?.id === 'verde-shared' || option?.label === 'Shared campus loop') {
			return sharedLoopMap;
		}
		return directPickupMap;
	}

	function routeMapProps() {
		const showAllPickups = session.phase === 'booking' && !hasRequestedRide;
		const selectedPickup = session.phase === 'arrival' ? '__none__' : focusOption?.pickupPoint;
		const rideMap = mapForRideOption(focusOption);
		return {
			map: session.phase === 'booking' ? bookingMapForOption(focusOption) : rideMap,
			phase: session.phase,
			adaptive: isAdaptive,
			showLabels: false,
			showAllPickups,
			selectedPickup,
			participantProgress: session.locationOverride?.participantProgress,
			participantX: session.locationOverride?.participantX,
			participantY: session.locationOverride?.participantY,
			participantDirectionDegrees: session.locationOverride?.participantDirectionDegrees,
			shuttleProgress: shuttleProgressForTiming(),
			activeTriggerTags: isAdaptive ? (session.activeTriggerTags ?? []) : [],
			participantMode: true,
			motionEnabled: !previewCompact
		};
	}

	function routePositionSummary(): string {
		if (
			typeof session.locationOverride?.participantX === 'number' &&
			typeof session.locationOverride?.participantY === 'number'
		) {
			return 'Your position: live on map';
		}
		return `Your route progress: ${Math.round((session.locationOverride?.participantProgress ?? 0) * 100)}%`;
	}

	let activeRouteMapId = $derived.by(() => routeMapProps().map?.id ?? null);

	$effect(() => {
		if (routeMapViewState?.mapId && routeMapViewState.mapId !== activeRouteMapId) {
			routeMapViewState = null;
		}
	});

	function hasTrigger(tag: MapTriggerTag): boolean {
		return Boolean(session.activeTriggerTags?.includes(tag));
	}

	function activeCueLabels(): string {
		const cues = activeCueItems();
		return cues.length > 0 ? cues.join(', ') : 'none';
	}

	function activeCueItems(): string[] {
		const labels: Record<MapTriggerTag, string> = {
			pickup_zone_enter: 'pickup area reached',
			pickup_zone_exit: 'pickup area left',
			shuttle_arriving_zone_enter: 'shuttle approaching pickup',
			shuttle_arriving_zone_exit: 'shuttle left approach area',
			participant_route_start: 'route started',
			participant_midroute_enter: 'route progress updated',
			path_area_1_enter: 'first route segment reached',
			path_area_2_enter: 'second route segment reached',
			path_area_3_enter: 'halfway point reached',
			path_area_4_enter: 'final route segment reached',
			participant_wrong_way: 'walking away from route',
			participant_waiting_zone_enter: 'waiting area reached',
			participant_waiting_zone_exit: 'waiting area left',
			boarding_zone_enter: 'boarding area reached',
			boarding_zone_exit: 'boarding area left',
			delay_notice_shown: 'delay notice shown',
			revised_eta_acknowledged: 'revised ETA confirmed'
		};
		return (session.activeTriggerTags ?? []).map((tag) => labels[tag]).filter(Boolean);
	}

	function routeGuideContent(): RouteGuideContent | null {
		if (!focusOption) return null;
		const cueItems = activeCueItems();
		const items: string[] = [];

		if (session.phase === 'booking') {
			items.push(`Pickup: ${focusOption.pickupPoint}`);
			items.push(`${focusOption.walkMinutes} min walk to pickup`);
			items.push(`${focusOption.rideMinutes} min ride to ${focusOption.destination}`);
			if (isAdaptive && focusOption.recommendationReason)
				items.push(focusOption.recommendationReason);
			return {
				title: 'Route preview',
				body: `From Current Location to ${focusOption.pickupPoint}.`,
				items
			};
		}

		if (session.phase === 'assignment') {
			items.push(`Pickup: ${focusOption.pickupPoint}`);
			items.push(
				isVehicleAssigned ? `${assignedVehicleLabel()} is assigned.` : 'Assignment in progress.'
			);
			items.push('Keep this route visible.');
		} else if (session.phase === 'waiting') {
			items.push(`Walk to ${focusOption.pickupPoint}.`);
			items.push('Stay on the highlighted route.');
			items.push('Pickup has not changed.');
		} else if (session.phase === 'delay') {
			items.push(`Pickup remains ${focusOption.pickupPoint}.`);
			items.push(`Updated ETA: ${etaMinutes('delay')} min.`);
			items.push('Stay with this route.');
		} else if (session.phase === 'near_arrival') {
			items.push(`Stay near ${focusOption.pickupPoint}.`);
			items.push(`Look for ${assignedVehicleLabel()}.`);
			items.push('Check the shuttle number.');
		} else if (session.phase === 'arrival') {
			items.push(`Match ${assignedVehicleLabel()} before you continue.`);
			items.push(
				`Ride time to ${focusOption.destination} is ${session.scenario.rideEtaAfterArrivalMinutes} min.`
			);
		}

		if (cueItems.length > 0) items.push(`Map cue: ${cueItems[0]}.`);
		if (items.length === 0) return null;
		return {
			title: guidanceTitle(session.phase),
			body: guidanceBody(session.phase),
			items
		};
	}

	function activeTriggerDecision(): TriggerDecision | null {
		const vehicleLabel = assignedVehicleLabel();
		if (assignmentVehicleFocusActive()) return null;
		if (hasTrigger('participant_wrong_way')) {
			return {
				sicTitle: 'Route update',
				aicTitle: 'Return to route',
				body: `Turn back toward ${focusOption?.pickupPoint}. Follow the highlighted path.`,
				update: `Off route. Head back toward ${focusOption?.pickupPoint}.`,
				tone: 'route'
			};
		}
		if (session.phase === 'delay' && hasTrigger('delay_notice_shown')) {
			return {
				sicTitle: 'Timing changed',
				aicTitle: 'Timing changed',
				body: `Pickup stays the same. Updated ETA: ${etaMinutes('delay')} min.`,
				update: `Updated ETA: ${etaMinutes('delay')} min.`,
				tone: 'delay'
			};
		}
		if (!isAdaptive && (session.phase === 'near_arrival' || session.phase === 'arrival')) {
			return null;
		}
		if (
			hasTrigger('shuttle_arriving_zone_enter') &&
			(hasTrigger('participant_waiting_zone_enter') || hasTrigger('pickup_zone_enter'))
		) {
			return {
				sicTitle: 'Shuttle approaching',
				aicTitle: 'Shuttle approaching',
				body: `The shuttle is entering pickup. Move toward the stop and check ${vehicleLabel}.`,
				update: `Shuttle approaching. Check ${vehicleLabel}.`,
				tone: 'arrival'
			};
		}
		if (hasTrigger('shuttle_arriving_zone_exit')) {
			return {
				sicTitle: 'Shuttle Arriving Soon',
				aicTitle: 'Shuttle Arriving Soon',
				body: `Look for ${vehicleLabel}. The shuttle is arriving soon.`,
				update: `Shuttle arriving soon. Check ${vehicleLabel}.`,
				tone: 'arrival'
			};
		}
		if (hasTrigger('pickup_zone_exit') || hasTrigger('participant_waiting_zone_exit')) {
			return {
				sicTitle: 'Pickup update',
				aicTitle: 'Return to pickup',
				body: `Move back toward ${focusOption?.pickupPoint}. Pickup has not changed.`,
				update: `Return to ${focusOption?.pickupPoint}.`,
				tone: 'route'
			};
		}
		if (hasTrigger('boarding_zone_enter')) {
			return {
				sicTitle: 'Stop reached',
				aicTitle: 'Stop reached',
				body: `You are at the stop. Match ${vehicleLabel} before you continue.`,
				update: `At the stop. Match ${vehicleLabel}.`,
				tone: 'boarding'
			};
		}
		if (hasTrigger('shuttle_arriving_zone_enter')) {
			return {
				sicTitle: 'Shuttle approaching',
				aicTitle: 'Shuttle approaching',
				body: `Look for ${vehicleLabel}. The shuttle is near pickup.`,
				update: `Shuttle approaching. Check ${vehicleLabel}.`,
				tone: 'arrival'
			};
		}
		if (hasTrigger('pickup_zone_enter') || hasTrigger('participant_waiting_zone_enter')) {
			return {
				sicTitle: 'Pickup area reached',
				aicTitle: 'Wait here for pickup',
				body: `Stay near ${focusOption?.pickupPoint}. Keep vehicle details visible.`,
				update: `At pickup. Wait here.`,
				tone: 'wait'
			};
		}
		if (hasTrigger('path_area_4_enter')) {
			return {
				sicTitle: 'Route progress update',
				aicTitle: 'Close to pickup',
				body: `Continue toward ${focusOption?.pickupPoint}.`,
				update: 'Close to pickup.',
				tone: 'route'
			};
		}
		if (hasTrigger('path_area_3_enter')) {
			return {
				sicTitle: 'Route progress update',
				aicTitle: 'Halfway to pickup',
				body: `Continue toward ${focusOption?.pickupPoint}.`,
				update: 'Halfway to pickup.',
				tone: 'route'
			};
		}
		if (hasTrigger('path_area_2_enter')) {
			return {
				sicTitle: 'Route progress update',
				aicTitle: 'Keep this path',
				body: `Continue along the mapped route to ${focusOption?.pickupPoint}.`,
				update: 'Continue forward.',
				tone: 'route'
			};
		}
		if (hasTrigger('path_area_1_enter')) {
			return {
				sicTitle: 'Route progress update',
				aicTitle: 'Route started',
				body: `Follow the mapped path toward ${focusOption?.pickupPoint}.`,
				update: 'Route started.',
				tone: 'route'
			};
		}
		if (hasTrigger('participant_midroute_enter')) {
			return {
				sicTitle: 'Route progress update',
				aicTitle: 'Continue this route',
				body: `Continue along the mapped route to ${focusOption?.pickupPoint}.`,
				update: 'Continue toward pickup.',
				tone: 'route'
			};
		}
		if (hasTrigger('participant_route_start')) {
			return {
				sicTitle: 'Route started',
				aicTitle: 'Follow the highlighted path',
				body: `Follow the mapped path toward ${focusOption?.pickupPoint}.`,
				update: 'Follow the highlighted path.',
				tone: 'route'
			};
		}
		if (hasTrigger('revised_eta_acknowledged')) {
			return {
				sicTitle: 'Timing confirmed',
				aicTitle: 'Timing confirmed',
				body: 'Continue with the updated ETA. Pickup is unchanged.',
				update: 'Updated ETA confirmed.',
				tone: 'delay'
			};
		}
		return null;
	}

	function optionInteractionPayload(option: RideOption | undefined, selectionMethod?: string) {
		return {
			optionId: option?.id,
			optionLabel: option?.label,
			pickupPoint: option?.pickupPoint,
			destination: option?.destination,
			waitMinutes: option ? optionWaitMinutes(option) : undefined,
			walkMinutes: option?.walkMinutes,
			rideMinutes: option?.rideMinutes,
			arrivalTime: option ? optionArrivalTime(option) : undefined,
			vehicleId: option?.vehicleId,
			isRecommended: Boolean(option?.isRecommended),
			selectionMethod
		};
	}

	function selectOption(option: RideOption, selectionMethod = 'participant_tap') {
		if (hasRequestedRide) return;
		const target =
			selectionMethod === 'adaptive_auto_recommendation'
				? 'ride_option_auto_select'
				: 'ride_option_select';
		onTrackedTap(target, {
			...commonInteractionPayload('booking_options'),
			...optionInteractionPayload(option, selectionMethod)
		});
		void onRideOptionChange(option.id, 'selected', {
			...optionInteractionPayload(option, selectionMethod)
		});
	}

	function autoSelectOption(option: RideOption) {
		selectOption(option, 'adaptive_auto_recommendation');
	}

	function requestRide() {
		if (!selectedOption || rideStatus !== 'selected') return;
		onTrackedTap('ride_request', {
			...commonInteractionPayload('booking_request'),
			...optionInteractionPayload(selectedOption, 'participant_request')
		});
		void onRideOptionChange(selectedOption.id, 'requested', {
			...optionInteractionPayload(selectedOption, 'participant_request')
		});
	}

	function commonInteractionPayload(source: string) {
		return {
			source,
			phase: session.phase,
			condition,
			block: session.activeBlock,
			rideStatus,
			selectedRideOptionId: activeBlock?.selectedRideOptionId,
			selectedRideOptionLabel: focusOption?.label,
			pickupPoint: focusOption?.pickupPoint,
			activeTriggerTags: session.activeTriggerTags ?? []
		};
	}

	function handleMapInteraction(interaction: RouteMapInteractionPayload) {
		onTrackedTap('map_interaction', {
			...commonInteractionPayload(interaction.source),
			...interaction,
			view: interaction.source === 'full_map' ? 'full_map' : 'inline_map'
		});
	}

	function handleRouteMapViewStateChange(state: RouteMapViewState) {
		routeMapViewState = state;
	}

	function openMap(source: string) {
		isFullMapOpen = true;
		openMapState = {
			source,
			openedAt: Date.now(),
			phase: session.phase,
			condition,
			selectedRideOptionId: activeBlock?.selectedRideOptionId
		};
		onTrackedTap('map_open', {
			...commonInteractionPayload(source),
			openMethod: 'tap',
			view: 'full_map'
		});
	}

	function openEtaModal() {
		openEtaState = {
			source: 'eta_card',
			openedAt: Date.now(),
			phase: session.phase,
			condition,
			selectedRideOptionId: activeBlock?.selectedRideOptionId
		};
		isEtaModalOpen = true;
		onTrackedTap('eta_details_open', {
			...commonInteractionPayload('eta_card'),
			view: 'eta_details_sheet',
			initialEtaMinutes: etaModalInitialMinutes(),
			updatedEtaMinutes: etaModalUpdatedMinutes(),
			etaChange: etaModalChangeLabel()
		});
	}

	function closeEtaModal(method: 'button' | 'backdrop' = 'button') {
		const opened = openEtaState;
		isEtaModalOpen = false;
		openEtaState = null;
		if (!opened) return;
		const durationMs = Date.now() - opened.openedAt;
		const payload = {
			...commonInteractionPayload(opened.source),
			openPhase: opened.phase,
			openCondition: opened.condition,
			closeMethod: method,
			durationMs,
			durationSeconds: Math.round(durationMs / 100) / 10,
			view: 'eta_details_sheet',
			initialEtaMinutes: etaModalInitialMinutes(),
			updatedEtaMinutes: etaModalUpdatedMinutes(),
			etaChange: etaModalChangeLabel()
		};
		onTrackedTap('eta_details_close', payload);
		onTrackedTap('eta_details_exposure', payload);
	}

	function closeMap(method: 'button' | 'detail_opened' = 'button') {
		const opened = openMapState;
		isFullMapOpen = false;
		openMapState = null;
		if (!opened) return;
		const durationMs = Date.now() - opened.openedAt;
		const payload = {
			...commonInteractionPayload(opened.source),
			openPhase: opened.phase,
			openCondition: opened.condition,
			closeMethod: method,
			durationMs,
			durationSeconds: Math.round(durationMs / 100) / 10,
			view: 'full_map'
		};
		onTrackedTap('map_close', payload);
		onTrackedTap('map_exposure', payload);
	}

	function openVehicleDetails() {
		isVehicleDetailsOpen = true;
		openVehicleState = {
			source: 'vehicle_section',
			openedAt: Date.now(),
			phase: session.phase,
			condition,
			selectedRideOptionId: activeBlock?.selectedRideOptionId
		};
		onTrackedTap('vehicle_details_open', {
			...commonInteractionPayload('vehicle_section'),
			view: 'vehicle_details_sheet',
			isVehicleAssigned,
			vehicleId: focusOption?.vehicleId
		});
	}

	function closeVehicleDetails(method: 'button' | 'backdrop' = 'button') {
		if (!isVehicleDetailsOpen) return;
		const opened = openVehicleState;
		isVehicleDetailsOpen = false;
		openVehicleState = null;
		const durationMs = opened ? Date.now() - opened.openedAt : 0;
		const payload = {
			...commonInteractionPayload(opened?.source ?? 'vehicle_details_sheet'),
			openPhase: opened?.phase,
			openCondition: opened?.condition,
			closeMethod: method,
			durationMs,
			durationSeconds: Math.round(durationMs / 100) / 10,
			view: 'vehicle_details_sheet',
			isVehicleAssigned,
			vehicleId: focusOption?.vehicleId
		};
		onTrackedTap('vehicle_details_close', {
			...payload
		});
		onTrackedTap('vehicle_details_exposure', payload);
	}

	function openDetail(topic: DetailTopic, source: string) {
		if (activeDetailTopic) closeDetail('replaced');
		activeDetailTopic = topic;
		openDetailState = {
			topic,
			source,
			openedAt: Date.now(),
			phase: session.phase,
			condition,
			selectedRideOptionId: activeBlock?.selectedRideOptionId,
			scrollDepth: 0
		};
		onTrackedTap('detail_open', {
			...commonInteractionPayload(source),
			topic,
			openMethod: 'tap',
			view: 'detail_sheet'
		});
	}

	function closeDetail(method: 'button' | 'backdrop' | 'replaced' | 'map_opened' = 'button') {
		const opened = openDetailState;
		activeDetailTopic = null;
		openDetailState = null;
		if (!opened) return;
		const durationMs = Date.now() - opened.openedAt;
		const payload = {
			...commonInteractionPayload(opened.source),
			topic: opened.topic,
			openPhase: opened.phase,
			openCondition: opened.condition,
			closeMethod: method,
			durationMs,
			durationSeconds: Math.round(durationMs / 100) / 10,
			maxScrollDepth: opened.scrollDepth,
			view: 'detail_sheet'
		};
		onTrackedTap('detail_close', payload);
		onTrackedTap('detail_exposure', payload);
	}

	function openMapFromDetail(source: string) {
		closeDetail('map_opened');
		openMap(source);
		onTrackedTap('detail_action', {
			...commonInteractionPayload(source),
			action: 'open_map_from_detail',
			view: 'detail_sheet'
		});
	}

	function handleDetailScroll(event: Event) {
		if (!openDetailState) return;
		const element = event.currentTarget as HTMLElement;
		const maxScroll = Math.max(0, element.scrollHeight - element.clientHeight);
		const scrollDepth = maxScroll > 0 ? Math.min(1, Math.max(0, element.scrollTop / maxScroll)) : 0;
		if (scrollDepth > openDetailState.scrollDepth) {
			openDetailState = { ...openDetailState, scrollDepth };
		}
	}

	function detailActionLabel(topic: DetailTopic): string {
		const labels: Record<DetailTopic, string> = {
			planning: 'Ride details',
			option: 'Ride details',
			route: 'Route',
			timing: 'Timing',
			vehicle: 'Vehicle',
			pickup: 'Pickup',
			sustainability: 'CO₂ impact',
			boarding: 'Boarding'
		};
		return labels[topic];
	}

	function detailActionClass(topic: DetailTopic): string {
		if (!isAdaptive) return 'border border-[var(--hairline)] bg-white text-forest';
		if (topic === 'timing' && session.phase === 'delay')
			return 'border border-[#E8D5A8] bg-[#FFF8EA] text-[#745116]';
		if (topic === 'boarding' || topic === 'vehicle')
			return 'border border-leaf bg-mint text-forest';
		return 'border border-leaf/40 bg-white text-forest shadow-[0_8px_22px_rgba(20,66,46,0.08)]';
	}

	function detailContent(topic: DetailTopic): DetailContent {
		const option = focusOption;
		const vehicleId = assignedVehicleLabel();
		const pickup = option?.pickupPoint ?? 'Selected pickup point';
		const destination = option?.destination ?? 'Destination';
		const selectedLabel = option?.label ?? 'Selected shuttle';
		const currentEta = etaMinutes(session.phase);
		if (topic === 'planning') {
			return {
				eyebrow: 'Ride planning',
				title: isAdaptive ? 'Ride fit' : 'Ride options',
				body: isAdaptive
					? 'VERDĒ weighs wait, walk, route, vehicle state, and arrival.'
					: 'Each option shows the same ride facts.',
				primary: selectedLabel,
				items: [
					{
						icon: 'map',
						label: 'Destination',
						value: destination,
						body: 'Same destination for this ride.'
					},
					{
						icon: 'clock',
						label: 'Pickup wait',
						value: `${optionWaitMinutes(option)} min`,
						body: 'Until the shuttle reaches pickup.'
					},
					{
						icon: 'walk',
						label: 'Walking time',
						value: `${option?.walkMinutes ?? 0} min`,
						body: 'From Current Location to pickup.'
					},
					{
						icon: 'leaf',
						label: 'CO₂ saved',
						value: `${co2SavedKg(option).toFixed(1)} kg`,
						body: co2DelayChangeKg() > 0 ? 'Updated after the delay.' : 'Compared with a car trip.'
					}
				]
			};
		}
		if (topic === 'option') {
			return {
				eyebrow: 'Selected option',
				title: isAdaptive ? 'Selected ride' : 'Selected option',
				body: isAdaptive
					? comparisonReason(option ?? recommendedOption)
					: 'Review this option before requesting.',
				primary: pickup,
				items: [
					{ icon: 'navigation', label: 'Pickup', value: pickup },
					{ icon: 'clock', label: 'Arrive around', value: optionArrivalTime(option) },
					{
						icon: 'route',
						label: 'Route',
						value: option?.routeSummary ?? 'Route details unavailable'
					},
					{ icon: 'users', label: 'Capacity', value: option?.occupancy ?? 'Capacity unavailable' }
				]
			};
		}
		if (topic === 'route') {
			return {
				eyebrow: 'Route details',
				title: isAdaptive ? 'Route watch' : 'Route',
				body: isAdaptive
					? 'The map follows your route and the shuttle approach.'
					: 'The map shows pickup, Current Location, and shuttle route.',
				primary: `${pickup} to ${destination}`,
				items: [
					{ icon: 'navigation', label: 'Pickup point', value: pickup },
					{
						icon: 'route',
						label: 'Route summary',
						value: option?.routeSummary ?? 'Route details unavailable'
					},
					{ icon: 'progress', label: 'Ride progress', value: `${progressPercent}%` },
					{
						icon: 'map',
						label: 'Map behavior',
						value: isAdaptive ? 'Live route cues' : 'Route view'
					}
				]
			};
		}
		if (topic === 'timing') {
			return {
				eyebrow: session.phase === 'delay' ? 'Updated timing' : 'Timing details',
				title: isAdaptive && session.phase === 'delay' ? 'Updated ETA' : 'Pickup timing',
				body:
					session.phase === 'delay'
						? 'Pickup stays the same. Updated ETA is now active.'
						: 'Timing follows this ride.',
				primary:
					session.phase === 'arrival'
						? `${session.scenario.rideEtaAfterArrivalMinutes} min ride`
						: `${currentEta} min pickup ETA`,
				items: [
					{
						icon: 'clock',
						label: 'Current ETA',
						value:
							session.phase === 'arrival'
								? `${session.scenario.rideEtaAfterArrivalMinutes} min ride`
								: `${currentEta} min`
					},
					{
						icon: 'clock',
						label: session.phase === 'delay' ? 'Expected remaining' : 'Original ETA',
						value: `${session.phase === 'delay' ? originalRemainingAtDelayMinutes() : originalEtaMinutes()} min`
					},
					{ icon: 'walk', label: 'Walk', value: `${option?.walkMinutes ?? 0} min` },
					{
						icon: 'vehicle',
						label: 'Ride',
						value: `${session.phase === 'arrival' ? session.scenario.rideEtaAfterArrivalMinutes : (option?.rideMinutes ?? 0)} min`
					}
				]
			};
		}
		if (topic === 'vehicle') {
			return {
				eyebrow: 'Vehicle details',
				title: isVehicleAssigned ? `${vehicleId} check` : 'Assignment pending',
				body: isVehicleAssigned
					? 'Match these details before you continue.'
					: 'Vehicle details appear after assignment.',
				primary: isVehicleAssigned ? vehicleId : 'Assignment in progress',
				items: [
					{
						icon: 'id',
						label: 'Vehicle ID',
						value: isVehicleAssigned ? vehicleId : 'Not assigned yet'
					},
					{
						icon: 'vehicle',
						label: 'Vehicle type',
						value: isVehicleAssigned ? (option?.vehicleType ?? 'Autonomous shuttle') : 'Pending'
					},
					{
						icon: 'battery',
						label: 'Battery',
						value: isVehicleAssigned ? `${option?.batteryPercent ?? 0}%` : 'Pending'
					},
					{
						icon: 'users',
						label: 'Capacity',
						value: isVehicleAssigned ? (option?.occupancy ?? 'Pending') : 'Pending'
					},
					{
						icon: 'seat',
						label: 'Comfort',
						value: isVehicleAssigned ? (option?.comfort ?? 'Pending') : 'Pending'
					}
				]
			};
		}
		if (topic === 'pickup') {
			return {
				eyebrow: 'Pickup details',
				title: isAdaptive ? 'Pickup guidance' : 'Pickup point',
				body: isAdaptive
					? 'Pickup stays steady. Guidance follows location and shuttle approach.'
					: 'Pickup stays steady.',
				primary: pickup,
				items: [
					{ icon: 'navigation', label: 'Pickup point', value: pickup },
					{ icon: 'walk', label: 'Walking time', value: `${option?.walkMinutes ?? 0} min` },
					{ icon: 'map', label: 'Map', value: 'Open route map' },
					{
						icon: 'shield',
						label: 'Check',
						value: 'Wait until the shuttle stops'
					}
				]
			};
		}
		if (topic === 'sustainability') {
			return {
				eyebrow: 'Ride impact',
				title: 'Impact',
				body: 'Impact is part of the ride view.',
				primary: `${co2SavedKg(option).toFixed(1)} kg CO₂`,
				items: [
					{
						icon: 'leaf',
						label: 'CO₂ saved',
						value: `${co2SavedKg(option).toFixed(1)} kg`
					},
					...(isAdaptive && co2DelayChangeKg() > 0
						? [
								{
									icon: 'leaf' as const,
									label: 'Initial CO₂',
									value: `${co2SavedKg(option, false).toFixed(1)} kg`
								},
								{
									icon: 'alert' as const,
									label: 'Delay change',
									value: co2ChangeLabel()
								}
							]
						: []),
					{ icon: 'battery', label: 'Battery', value: `${option?.batteryPercent ?? 0}%` },
					{
						icon: 'route',
						label: 'Route type',
						value: option?.routeSummary ?? 'Route details unavailable'
					},
					{
						icon: 'users',
						label: 'Ride format',
						value: option?.tags.join(', ') ?? 'Campus shuttle'
					}
				]
			};
		}
		return {
			eyebrow: 'Vehicle check',
			title: isAdaptive ? 'Final check' : 'Vehicle check',
			body: 'Use the vehicle ID, type, and pickup cue.',
			primary: isVehicleAssigned ? vehicleId : 'Assignment pending',
			items: [
				{ icon: 'navigation', label: 'Pickup area', value: pickup },
				{ icon: 'id', label: 'Vehicle ID', value: isVehicleAssigned ? vehicleId : 'Pending' },
				{ icon: 'shield', label: 'Check', value: 'Continue after the vehicle has stopped' },
				{
					icon: 'clock',
					label: 'Ride time',
					value: `${session.scenario.rideEtaAfterArrivalMinutes} min`
				}
			]
		};
	}

	function operationalDetailSections(topic: DetailTopic): DetailContent['sections'] {
		const option = focusOption;
		const pickup = option?.pickupPoint ?? 'Selected pickup point';
		const destination = option?.destination ?? 'Destination';
		const vehicleId = assignedVehicleLabel();
		const routeState =
			session.phase === 'booking'
				? 'Review options before requesting.'
				: session.phase === 'assignment'
					? 'VERDĒ is assigning a shuttle.'
					: session.phase === 'delay'
						? 'Timing changed. Pickup is unchanged.'
						: session.phase === 'near_arrival'
							? 'The shuttle is near pickup.'
							: session.phase === 'arrival'
								? 'The shuttle has arrived. Match the number.'
								: 'The shuttle is on the way.';

		if (topic === 'planning') {
			return [
				{
					title: 'Trip setup',
					body: 'This ride has one destination and a small set of pickup choices.',
					items: [
						`Start: Current Location`,
						`Destination: ${destination}`,
						'Review options before requesting.'
					]
				},
				{
					title: isAdaptive ? 'How VERDĒ chooses' : 'Comparison fields',
					body: isAdaptive
						? 'VERDĒ balances nearby pickup, wait, walk, and vehicle state.'
						: 'Each option shows the same fields.',
					items: [
						`Wait: ${optionWaitMinutes(option)} min`,
						`Walk: ${option?.walkMinutes ?? 0} min`,
						`Ride: ${option?.rideMinutes ?? 0} min`,
						`Impact: ${co2SavedKg(option).toFixed(1)} kg CO₂`
					]
				}
			];
		}

		if (topic === 'option') {
			return [
				{
					title: 'Request summary',
					body: 'This option is sent when you request the ride.',
					items: [
						`Pickup: ${pickup}`,
						`Destination: ${destination}`,
						`Arrival around: ${optionArrivalTime(option)}`,
						`Vehicle pool: ${option?.vehicleType ?? 'Autonomous shuttle'}`
					]
				},
				{
					title: 'After request',
					body: 'After request, VERDĒ assigns the shuttle.',
					items: [
						'Vehicle details appear.',
						'Pickup stays visible.',
						'Timing stays in this ride view.',
						'Delay updates appear here.'
					]
				}
			];
		}

		if (topic === 'route') {
			return [
				{
					title: 'Route guidance',
					body: 'The map shows your path, pickup, shuttle path, and Current Location.',
					items: [
						`Current pickup: ${pickup}`,
						`Walking route: ${option?.walkMinutes ?? 0} min`,
						`Shuttle progress: ${Math.round(shuttleProgressForTiming() * 100)}%`,
						routePositionSummary()
					]
				},
				{
					title: isAdaptive ? 'Live route cues' : 'Route status',
					body: isAdaptive
						? 'When location changes, VERDĒ brings the next action forward.'
						: 'Route updates stay in the status text and map.',
					items: [
						routeState,
						`Active route cues: ${activeCueLabels()}`,
						'Internal map labels stay hidden.'
					]
				}
			];
		}

		if (topic === 'timing') {
			return [
				{
					title: session.phase === 'delay' ? 'Updated timing' : 'Pickup timing',
					body:
						session.phase === 'delay'
							? 'Updated ETA is active. Initial ETA stays visible.'
							: 'ETA follows the current ride timing.',
					items: [
						`Current pickup ETA: ${session.phase === 'arrival' ? 'arrived' : `${etaMinutes(session.phase)} min`}`,
						`Original ETA: ${originalEtaMinutes()} min`,
						...(session.phase === 'delay'
							? [`Before update: ${originalRemainingAtDelayMinutes()} min`]
							: []),
						`Updated ETA: ${session.phase === 'delay' ? `${etaMinutes('delay')} min` : 'not active'}`,
						`Ride after pickup: ${session.phase === 'arrival' ? session.scenario.rideEtaAfterArrivalMinutes : (option?.rideMinutes ?? 0)} min`
					]
				},
				{
					title: 'Ride clock',
					body: 'VERDĒ keeps pickup, delay, and approach timing in one place.',
					items: [
						`Ride progress: ${progressPercent}%`,
						`Ride window: ${Math.round(session.scenario.durationSeconds / 60)} min`,
						`Timing updates: ${session.scenario.includeDelay ? 'active' : 'none'}`
					]
				}
			];
		}

		if (topic === 'vehicle') {
			return [
				{
					title: isAdaptive ? 'Vehicle check' : 'Vehicle verification',
					body: isVehicleAssigned
						? 'Compare the app details with the shuttle in front of you.'
						: 'Vehicle details appear after assignment.',
					items: [
						`Vehicle ID: ${isVehicleAssigned ? vehicleId : 'pending'}`,
						`Type: ${isVehicleAssigned ? (option?.vehicleType ?? 'Autonomous shuttle') : 'pending'}`,
						`Battery: ${isVehicleAssigned ? `${option?.batteryPercent ?? 0}%` : 'pending'}`,
						`Capacity: ${isVehicleAssigned ? (option?.occupancy ?? 'pending') : 'pending'}`
					]
				},
				{
					title: 'Vehicle match',
					body: 'Vehicle details stay visible near pickup.',
					items: [
						'Do not continue with a different vehicle number.',
						'Wait until the shuttle stops.',
						`Comfort: ${isVehicleAssigned ? (option?.comfort ?? 'pending') : 'pending'}`
					]
				}
			];
		}

		if (topic === 'pickup') {
			return [
				{
					title: 'Pickup access',
					body: 'Pickup stays stable through timing updates.',
					items: [
						`Pickup point: ${pickup}`,
						`Walking time: ${option?.walkMinutes ?? 0} min`,
						`Current ETA: ${session.phase === 'arrival' ? 'arrived' : `${etaMinutes(session.phase)} min`}`,
						`Next step: ${session.phase === 'near_arrival' ? 'stay at the stop' : 'stay near pickup'}`
					]
				},
				{
					title: isAdaptive ? 'Location cues' : 'Pickup status',
					body: isAdaptive
						? 'VERDĒ adjusts guidance when your location changes.'
						: 'Pickup changes appear as status information.',
					items: [
						`Active location cues: ${activeCueLabels()}`,
						'Internal service labels stay hidden.',
						'Current Location updates the route view.'
					]
				}
			];
		}

		if (topic === 'sustainability') {
			return [
				{
					title: isAdaptive ? 'Impact overview' : 'Shuttle state',
					body: 'Impact and vehicle state stay with the ride details.',
					items: [
						`Battery: ${option?.batteryPercent ?? 0}%`,
						`CO₂: ${co2SavedKg(option).toFixed(1)} kg`,
						...(isAdaptive && co2DelayChangeKg() > 0
							? [
									`Initial CO₂: ${co2SavedKg(option, false).toFixed(1)} kg`,
									`Delay change: ${co2ChangeLabel()}`
								]
							: []),
						`Ride format: ${option?.tags.join(', ') ?? 'campus shuttle'}`,
						`Capacity: ${option?.occupancy ?? 'capacity unavailable'}`
					]
				},
				{
					title: 'Impact context',
					body: 'The same ride facts are available in both conditions.',
					items: [
						'CO₂ is shown as a ride attribute.',
						'Battery is vehicle information.',
						'No payment or account is shown.'
					]
				}
			];
		}

		return [
			{
				title: isAdaptive ? 'Arrival check' : 'Near-arrival check',
				body: 'This ride view finishes when the shuttle reaches pickup.',
				items: [
					`Pickup area: ${pickup}`,
					`Vehicle ID: ${isVehicleAssigned ? vehicleId : 'pending'}`,
					`Ride after pickup: ${session.scenario.rideEtaAfterArrivalMinutes} min`,
					'Match the vehicle number.'
				]
			},
			{
				title: isAdaptive ? 'Approach focus' : 'Approach information',
				body: isAdaptive
					? 'Near arrival highlights vehicle identity.'
					: 'Near arrival keeps vehicle and route together.',
				items: ['Vehicle identity stays visible.', 'The block ends after the arrival buffer.']
			}
		];
	}

	function optionClass(option: RideOption): string {
		const recommended = isAdaptive && option.isRecommended;
		if (recommended) return 'aic-recommended border-leaf bg-mint';
		if (isAdaptive) return 'aic-option-secondary border-[var(--hairline)] bg-white';
		return 'border-[var(--hairline)] bg-white';
	}

	function benefitClass(index: number): string {
		if (!isAdaptive) return 'bg-white text-forest border border-[var(--hairline)]';
		if (index === 0) return 'bg-mint text-forest';
		if (index === 1) return 'bg-[#EAF2FF] text-[#225EA8]';
		return 'bg-[#FFF4DE] text-[#745116]';
	}

	function triggerToneIcon(): IconName {
		const decision = activeTriggerDecision();
		if (!decision) return 'route';
		if (decision.tone === 'delay') return 'alert';
		if (decision.tone === 'boarding') return 'shield';
		if (decision.tone === 'arrival') return 'vehicle';
		return 'route';
	}

	function bookingOptionViews(): BookingOptionView[] {
		return optionOrder.map((option) => ({
			option,
			waitMinutes: optionWaitMinutes(option),
			arrivalTime: optionArrivalTime(option),
			comparisonReason: comparisonReason(option),
			isSelected: option.id === selectedOption?.id,
			isRecommended: Boolean(option.isRecommended)
		}));
	}

	function journeyStepStates(): JourneyStepState[] {
		return journeySteps.map((step) => ({ ...step, state: stepState(step.key) }));
	}

	function metricItems(): MetricItem[] {
		return [
			{
				icon: 'clock',
				value:
					session.phase === 'near_arrival' || session.phase === 'arrival'
						? 'Now'
						: `${etaMinutes(session.phase)}`,
				label:
					session.phase === 'near_arrival' || session.phase === 'arrival' ? 'pickup' : 'min ETA'
			},
			{ icon: 'walk', value: `${focusOption?.walkMinutes ?? 0}`, label: 'min walk' },
			{
				icon: 'vehicle',
				value: `${session.phase === 'arrival' ? session.scenario.rideEtaAfterArrivalMinutes : (focusOption?.rideMinutes ?? 0)}`,
				label: 'min ride'
			},
			{
				icon: 'leaf',
				value: `${co2SavedKg(focusOption).toFixed(1)}`,
				label: 'kg saved',
				changeLabel: isAdaptive ? co2ChangeLabel() : '',
				detailLabel:
					isAdaptive && co2DelayChangeKg() > 0
						? `initial ${co2SavedKg(focusOption, false).toFixed(1)} kg`
						: '',
				tone: co2DelayChangeKg() > 0 ? 'delay' : 'neutral'
			}
		];
	}

	function detailSheetContent(topic: DetailTopic): DetailContent {
		return { ...detailContent(topic), sections: operationalDetailSections(topic) };
	}

	function stepState(step: StudyPhase): 'active' | 'done' | 'pending' {
		if (step === 'near_arrival') return 'pending';
		const currentStep =
			session.phase === 'near_arrival' || session.phase === 'arrival'
				? 'delay'
				: session.phase === 'booking'
					? 'assignment'
					: session.phase;
		const currentIndex = journeySteps.findIndex((item) => item.key === currentStep);
		const stepIndex = journeySteps.findIndex((item) => item.key === step);
		if (currentIndex < 0 || stepIndex < 0) return 'pending';
		if (stepIndex < currentIndex) return 'done';
		if (stepIndex === currentIndex) return 'active';
		return 'pending';
	}

	function comparisonReason(option: RideOption | undefined): string {
		if (!option) return 'Select a shuttle to compare wait, walk, route, and vehicle state.';
		if (!recommendedOption || option.id === recommendedOption.id) {
			return option.recommendationReason || 'Closest pickup with a steady route.';
		}
		const waitDifference = optionWaitMinutes(option) - optionWaitMinutes(recommendedOption);
		const walkDifference = option.walkMinutes - recommendedOption.walkMinutes;
		const co2Difference = co2SavedKg(option, false) - co2SavedKg(recommendedOption, false);
		const differences: string[] = [];
		if (waitDifference > 0) differences.push(`${waitDifference} min more waiting`);
		if (waitDifference < 0) differences.push(`${Math.abs(waitDifference)} min less waiting`);
		if (walkDifference > 0) differences.push(`${walkDifference} min more walking`);
		if (walkDifference < 0) differences.push(`${Math.abs(walkDifference)} min less walking`);
		if (co2Difference > 0.05) differences.push(`${co2Difference.toFixed(1)} kg more CO₂ saved`);
		if (co2Difference < -0.05)
			differences.push(`${Math.abs(co2Difference).toFixed(1)} kg less CO₂ saved`);
		if (differences.length === 0) {
			return `Similar to ${recommendedOption.label}, with a different pickup point.`;
		}
		return `Compared with ${recommendedOption.label}: ${differences.join(', ')}.`;
	}

	function vehicleEventTone(): 'neutral' | 'delay' | 'arrival' | 'boarding' {
		if (!isAdaptive) return 'neutral';
		if (session.phase === 'delay' || hasTrigger('delay_notice_shown')) return 'delay';
		if (session.phase === 'arrival' || hasTrigger('shuttle_arriving_zone_enter')) return 'arrival';
		if (session.phase === 'near_arrival' || hasTrigger('boarding_zone_enter')) return 'boarding';
		return 'neutral';
	}

	function vehicleMetricClass(): string {
		if (!isAdaptive) return 'border-l border-[var(--hairline)] pl-2';
		const tone = vehicleEventTone();
		if (tone === 'delay') return 'border-l border-[#E8D5A8] pl-2';
		if (tone === 'arrival' || tone === 'boarding') return 'border-l border-leaf pl-2';
		return 'border-l border-[var(--hairline)] pl-2';
	}

	function vehicleIdentifierClass(): string {
		if (!isAdaptive) return 'text-forest';
		const tone = vehicleEventTone();
		if (tone === 'delay') return 'text-[#745116]';
		if (tone === 'arrival' || tone === 'boarding') return 'text-forest';
		return 'text-forest';
	}

	function vehicleMediaClass(): string {
		if (!isAdaptive) return '';
		const tone = vehicleEventTone();
		if (tone === 'delay') return 'text-[#745116]';
		if (tone === 'arrival' || tone === 'boarding') return 'text-forest';
		return '';
	}

	function vehicleIconClass(): string {
		if (!isAdaptive) return 'border border-[var(--hairline)] bg-white text-forest';
		const tone = vehicleEventTone();
		if (tone === 'delay') return 'bg-attention text-white';
		if (tone === 'arrival' || tone === 'boarding') return 'bg-forest text-white';
		return 'bg-mint text-forest';
	}

	function detailRowClass(kind: 'default' | 'delay' = 'default'): string {
		if (!isAdaptive) return 'border border-transparent bg-white';
		if (kind === 'delay') return 'border border-[#E8D5A8] bg-[#FFF8EA] text-[#745116]';
		return 'bg-canvas-mist';
	}

	function flowPriority(module: RideModule): number {
		const index = flowOrder.indexOf(module);
		return index >= 0 ? index : flowOrder.length;
	}

	function statusUpdateContext(): string {
		const decision = activeTriggerDecision();
		if (decision) return decision.update;
		if (session.phase === 'assignment') {
			return isAdaptive
				? 'VERDĒ is matching shuttle, pickup, and route.'
				: 'Shuttle assignment is being confirmed.';
		}
		if (session.phase === 'waiting') {
			return isAdaptive
				? 'Walk to pickup and keep the route visible.'
				: 'Walk to pickup and wait there.';
		}
		if (session.phase === 'delay') {
			return isAdaptive
				? 'Updated timing is active. Pickup stays fixed.'
				: 'Timing changed. Pickup stays the same.';
		}
		if (session.phase === 'near_arrival') {
			return isAdaptive
				? 'Vehicle number is now the key check.'
				: 'The shuttle is approaching pickup.';
		}
		if (session.phase === 'arrival') {
			return isAdaptive ? 'Match the vehicle before you continue.' : 'The shuttle is arriving.';
		}
		return 'Ride guidance remains available.';
	}
</script>

<AppShell
	{previewCompact}
	isAdaptive={isAdaptive && session.status !== 'completed' && session.status !== 'study_finished'}
>
	{#if isSicBoardingScreen && session.sicBoardingStep}
		<SicBoardingScreen step={session.sicBoardingStep} />
	{:else if session.status === 'study_finished' || session.status === 'completed'}
		<CompletionBridge
			status={session.status}
			copy={session.status === 'study_finished' ? copy('study_finished') : copy('block_finished')}
		/>
	{:else if session.phase === 'booking'}
		<BookingOptions
			{isAdaptive}
			recommendedDestination={recommendedOption?.destination}
			routeMapProps={routeMapProps()}
			options={optionViews}
			{selectedOption}
			{hasSelection}
			{hasRequestedRide}
			onOpenMap={openMap}
			onMapInteraction={handleMapInteraction}
			viewState={routeMapViewState}
			onViewStateChange={handleRouteMapViewStateChange}
			onSelectOption={selectOption}
			onAutoSelectOption={autoSelectOption}
			onRequestRide={requestRide}
		/>
	{:else if !isAdaptive}
		<div class="mt-3 grid gap-4 pb-6" data-log-surface="sic_ride_screen">
			<RouteApproachPanel
				phase={session.phase}
				{isAdaptive}
				routeMapProps={routeMapProps()}
				onOpenMap={openMap}
				onMapInteraction={handleMapInteraction}
				viewState={routeMapViewState}
				onViewStateChange={handleRouteMapViewStateChange}
			/>

			<RideStatusSection
				{isAdaptive}
				journeySteps={stepViews}
				etaLabel={pickupEtaLabel()}
				etaCaption={pickupEtaCaption()}
				etaChangeLabel={etaChangeLabel()}
				etaTone={etaTone()}
				onOpenEtaDetails={openEtaModal}
			/>

			<VehicleCard
				phase={session.phase}
				{isAdaptive}
				{isVehicleAssigned}
				{focusOption}
				vehicleIdentifiers={session.scenario.vehicleIdentifiers}
				vehicleIconClass={vehicleIconClass()}
				vehicleMediaClass={vehicleMediaClass()}
				vehicleIdentifierClass={vehicleIdentifierClass()}
				onOpenDetails={openVehicleDetails}
			/>

			<h1 class="text-3xl leading-none font-bold text-forest">
				{screenHeadline()}
			</h1>

			<StatusUpdate
				{isAdaptive}
				title={statusUpdateTitle()}
				body={statusUpdateBody()}
				update={statusUpdateContext()}
				tone={statusUpdateTone()}
				icon={statusUpdateIcon()}
			/>

			<MetricStack {isAdaptive} {metrics} />
		</div>
	{:else}
		<div class="mt-3 grid gap-4 pb-6" data-log-surface="aic_ride_screen">
			<div style:order={flowPriority('guidance')} data-log-surface="guidance_module">
				<RideStatusSection
					{isAdaptive}
					journeySteps={stepViews}
					etaLabel={pickupEtaLabel()}
					etaCaption={pickupEtaCaption()}
					etaChangeLabel={etaChangeLabel()}
					etaTone={etaTone()}
					onOpenEtaDetails={openEtaModal}
				/>

				<h1 class="text-4xl leading-none font-bold text-forest" class:text-[2.6rem]={isAdaptive}>
					{screenHeadline()}
				</h1>

				<StatusUpdate
					{isAdaptive}
					title={statusUpdateTitle()}
					body={statusUpdateBody()}
					update={statusUpdateContext()}
					tone={statusUpdateTone()}
					icon={statusUpdateIcon()}
				/>
			</div>

			<div style:order={flowPriority('map')} data-log-surface="map_module">
				<RouteApproachPanel
					phase={session.phase}
					{isAdaptive}
					routeMapProps={routeMapProps()}
					onOpenMap={openMap}
					onMapInteraction={handleMapInteraction}
					viewState={routeMapViewState}
					onViewStateChange={handleRouteMapViewStateChange}
				/>
			</div>

			<div style:order={flowPriority('vehicle')} data-log-surface="vehicle_module">
				<VehicleCard
					phase={session.phase}
					{isAdaptive}
					{isVehicleAssigned}
					{focusOption}
					vehicleIdentifiers={session.scenario.vehicleIdentifiers}
					vehicleIconClass={vehicleIconClass()}
					vehicleMediaClass={vehicleMediaClass()}
					vehicleIdentifierClass={vehicleIdentifierClass()}
					onOpenDetails={openVehicleDetails}
				/>
			</div>

			<div style:order={flowPriority('timeline')} data-log-surface="timeline_module">
				<MetricStack {isAdaptive} {metrics} />
			</div>

			<div style:order={flowPriority('pickup')} data-log-surface="pickup_module">
				<BoardingChecklist phase={session.phase} {isAdaptive} />
			</div>
		</div>
	{/if}

	{#if isVehicleDetailsOpen}
		<VehicleDetailsSheet
			{isAdaptive}
			{isVehicleAssigned}
			{focusOption}
			onClose={closeVehicleDetails}
		/>
	{/if}

	{#if isEtaModalOpen}
		<ETAInfoModal
			originalEta={etaModalInitialMinutes()}
			revisedEta={etaModalUpdatedMinutes()}
			delta={etaModalChangeLabel()}
			{isAdaptive}
			onClose={closeEtaModal}
		/>
	{/if}

	{#if isFullMapOpen}
		<FullMapOverlay
			title={focusOption?.pickupPoint ?? 'Pickup options'}
			routeMapProps={routeMapProps()}
			routeGuide={routeGuideContent()}
			onClose={closeMap}
			onMapInteraction={handleMapInteraction}
			viewState={routeMapViewState}
			onViewStateChange={handleRouteMapViewStateChange}
		/>
	{/if}
</AppShell>

<style>
	/* Section styles live in the participant subcomponents; this block keeps Vite HMR style transforms stable. */
</style>
