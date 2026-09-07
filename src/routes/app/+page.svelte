<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import ParticipantRide from '$lib/components/ParticipantRide.svelte';
	import type { PageData } from './$types';
	import type {
		Condition,
		MapTriggerTag,
		RideOption,
		RideRequestStatus,
		SicBoardingStep,
		SessionLiveState,
		SessionStatus,
		StateResponse,
		StudyPhase
	} from '$lib/types';

	type NotificationSupport = NotificationPermission | 'unsupported';
	type NotificationSnapshot = {
		sessionId: string;
		block: number;
		phase: StudyPhase;
		status: SessionStatus;
		rideStatus: RideRequestStatus;
		triggerSignature: string;
	};
	type BoardingCueSnapshot = {
		sessionId: string;
		block: number;
		phase: StudyPhase;
		status: SessionStatus;
		sicBoardingStep?: SicBoardingStep;
	};
	type AppChange =
		| { kind: 'phase'; phase: StudyPhase }
		| { kind: 'trigger'; trigger: MapTriggerTag }
		| { kind: 'ride_status'; rideStatus: RideRequestStatus }
		| { kind: 'status'; status: SessionStatus };
	type RideAlert = {
		title: string;
		body: string;
		tag: string;
	};
	type AudioCue = 'neutral' | 'success' | 'warning';
	type LiveLocationBroadcast = {
		type: 'verde_live_location';
		sessionId: string;
		locationOverride?: NonNullable<StateResponse['session']>['locationOverride'];
		activeTriggerTags?: MapTriggerTag[];
		updatedAt: string;
	};
	type PointerStart = {
		pointerId: number;
		clientX: number;
		clientY: number;
		pageX: number;
		pageY: number;
		startedAt: number;
		target: InteractionTarget;
	};
	type InteractionTarget = {
		target: string;
		surface?: string;
		kind: 'actionable' | 'disabled' | 'non_actionable';
		tagName?: string;
		role?: string;
		ariaLabel?: string;
		text?: string;
		id?: string;
		name?: string;
		type?: string;
		variant?: string;
		href?: string;
		elementPath?: string;
		bounds?: {
			x: number;
			y: number;
			width: number;
			height: number;
		};
		offsetX?: number;
		offsetY?: number;
	};

	let { data }: { data: PageData } = $props();
	// svelte-ignore state_referenced_locally
	let appState: StateResponse = $state(data.initialState);
	let error = $state('');
	let notificationPermission: NotificationSupport = $state('unsupported');
	let feedbackMessage = $state('');
	let lastPhase: StudyPhase | null = null;
	let lastPhaseEnteredAt = Date.now();
	let hasLoggedInitialVisit = false;
	let hasLoggedAudioUnavailable = false;
	let lastScreenKey = '';
	let lastScrollLoggedAt = 0;
	let lastLiveScrollSentAt = 0;
	let hasLoggedHapticUnavailable = false;
	let notificationRegistration: ServiceWorkerRegistration | null = null;
	let notificationSnapshot: NotificationSnapshot | null = null;
	let boardingCueSnapshot: BoardingCueSnapshot | null = null;
	let liveLocationChannel: BroadcastChannel | null = null;
	let liveEventSource: EventSource | null = null;
	let audioUnlocked = false;
	const pointerStarts = new Map<number, PointerStart>();
	const audioSources: Record<AudioCue, string> = {
		neutral: '/neutral-ui-tone.wav',
		success: '/success-ui-chime.mp3',
		warning: '/warning-ui-alert.wav'
	};
	const audioElements: Partial<Record<AudioCue, HTMLAudioElement>> = {};
	let cuePlaybackElement: HTMLAudioElement | null = null;

	let session = $derived(appState.session);
	let map = $derived(appState.map);
	let activeBlock = $derived(session?.blocks.find((block) => block.block === session.activeBlock));
	let activeRideOption = $derived(getActiveRideOption());

	function isStudyScreenActive(): boolean {
		return Boolean(
			session &&
			session.status !== 'completed' &&
			session.status !== 'study_finished' &&
			session.status !== 'cancelled'
		);
	}

	function canRecordParticipantEvent(allowCompleted = false): boolean {
		return Boolean(
			session &&
			session.status !== 'study_finished' &&
			session.status !== 'cancelled' &&
			(allowCompleted || session.status !== 'completed')
		);
	}

	function clientEventContext(): Record<string, unknown> {
		if (!browser) return {};
		return {
			clientTimestamp: new Date().toISOString(),
			visibilityState: document.visibilityState,
			online: navigator.onLine,
			standalone: isStandaloneWebApp(),
			pathname: page.url.pathname,
			viewportWidth: window.innerWidth,
			viewportHeight: window.innerHeight,
			scrollY: Math.round(window.scrollY),
			devicePixelRatio: window.devicePixelRatio,
			maxTouchPoints: navigator.maxTouchPoints,
			language: navigator.language,
			timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
			orientation:
				typeof screen !== 'undefined' && screen.orientation
					? screen.orientation.type
					: window.innerWidth >= window.innerHeight
						? 'landscape'
						: 'portrait'
		};
	}

	async function postEvent(
		type: string,
		payload: Record<string, unknown> = {},
		options: { allowCompleted?: boolean } = {}
	) {
		if (!canRecordParticipantEvent(Boolean(options.allowCompleted))) return;
		await fetch('/api/session/event', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				type,
				source: 'participant_app',
				payload: { screen: 'app', ...clientEventContext(), ...payload }
			})
		}).catch(() => undefined);
	}

	function postEventBeacon(type: string, payload: Record<string, unknown> = {}) {
		if (!browser || !isStudyScreenActive()) return;
		const body = JSON.stringify({
			type,
			source: 'participant_app',
			payload: { screen: 'app', ...clientEventContext(), ...payload }
		});
		if (navigator.sendBeacon) {
			const didQueue = navigator.sendBeacon(
				'/api/session/event',
				new Blob([body], { type: 'application/json' })
			);
			if (didQueue) return;
		}
		void fetch('/api/session/event', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body,
			keepalive: true
		}).catch(() => undefined);
	}

	function normalizedText(value: string | null | undefined): string | undefined {
		const text = value?.replace(/\s+/g, ' ').trim();
		if (!text) return undefined;
		return text.length > 120 ? `${text.slice(0, 117)}...` : text;
	}

	function elementDataset(element: Element | null): DOMStringMap {
		return ((element as HTMLElement | SVGElement | null)?.dataset ?? {}) as DOMStringMap;
	}

	function closestElement(start: Element | null, selector: string): Element | null {
		return start?.closest(selector) ?? null;
	}

	function elementPath(element: Element | null): string | undefined {
		if (!element) return undefined;
		const parts: string[] = [];
		let current: Element | null = element;
		while (current && parts.length < 5) {
			const dataset = elementDataset(current);
			const label =
				dataset.logTarget ??
				dataset.logSurface ??
				current.getAttribute('aria-label') ??
				current.getAttribute('role') ??
				current.tagName.toLowerCase();
			parts.unshift(label);
			if (dataset.logSurface === 'participant_app_shell') break;
			current = current.parentElement;
		}
		return parts.join(' > ');
	}

	function eventTargetElement(event: Event): Element | null {
		const path = event.composedPath();
		const target = path.find((item): item is Element => item instanceof Element);
		return target ?? (event.target instanceof Element ? event.target : null);
	}

	function isDisabledInteractive(element: Element | null): boolean {
		if (!element) return false;
		if (
			element instanceof HTMLButtonElement ||
			element instanceof HTMLInputElement ||
			element instanceof HTMLSelectElement ||
			element instanceof HTMLTextAreaElement
		) {
			return element.disabled;
		}
		return element.getAttribute('aria-disabled') === 'true';
	}

	function describeInteractionTarget(event: PointerEvent): InteractionTarget {
		const rawTarget = eventTargetElement(event);
		const semanticElement = closestElement(
			rawTarget,
			[
				'[data-log-target]',
				'button',
				'a[href]',
				'[role="button"]',
				'input',
				'select',
				'textarea',
				'summary',
				'[tabindex]'
			].join(',')
		);
		const surfaceElement = closestElement(rawTarget, '[data-log-surface]');
		const targetElement = semanticElement ?? surfaceElement ?? rawTarget;
		const targetDataset = elementDataset(targetElement);
		const surfaceDataset = elementDataset(surfaceElement);
		const interactiveElement = closestElement(
			rawTarget,
			'button,a[href],[role="button"],input,select,textarea,summary,[tabindex]'
		);
		const disabled = isDisabledInteractive(interactiveElement);
		const bounds = targetElement?.getBoundingClientRect();
		const ariaLabel = normalizedText(targetElement?.getAttribute('aria-label'));
		const text = normalizedText((targetElement as HTMLElement | SVGElement | null)?.textContent);
		const href =
			targetElement instanceof HTMLAnchorElement ? targetElement.href : targetElement?.getAttribute('href');
		const fallbackTarget =
			ariaLabel ??
			text ??
			targetElement?.getAttribute('name') ??
			targetElement?.id ??
			targetElement?.tagName.toLowerCase() ??
			'unknown';
		return {
			target: targetDataset.logTarget ?? fallbackTarget,
			surface: targetDataset.logSurface ?? surfaceDataset.logSurface,
			kind: interactiveElement ? (disabled ? 'disabled' : 'actionable') : 'non_actionable',
			tagName: targetElement?.tagName.toLowerCase(),
			role: targetElement?.getAttribute('role') ?? undefined,
			ariaLabel,
			text,
			id: targetElement?.id || undefined,
			name: targetElement?.getAttribute('name') ?? undefined,
			type: targetDataset.logType ?? targetElement?.getAttribute('type') ?? undefined,
			variant: targetDataset.variant,
			href: href ?? undefined,
			elementPath: elementPath(targetElement),
			bounds: bounds
				? {
						x: Math.round(bounds.x),
						y: Math.round(bounds.y),
						width: Math.round(bounds.width),
						height: Math.round(bounds.height)
					}
				: undefined,
			offsetX: bounds ? Math.round(event.clientX - bounds.left) : undefined,
			offsetY: bounds ? Math.round(event.clientY - bounds.top) : undefined
		};
	}

	function handleGlobalPointerDown(event: PointerEvent) {
		if (!isStudyScreenActive()) return;
		pointerStarts.set(event.pointerId, {
			pointerId: event.pointerId,
			clientX: event.clientX,
			clientY: event.clientY,
			pageX: event.pageX,
			pageY: event.pageY,
			startedAt: Date.now(),
			target: describeInteractionTarget(event)
		});
	}

	function handleGlobalPointerUp(event: PointerEvent) {
		if (!isStudyScreenActive()) return;
		const started = pointerStarts.get(event.pointerId);
		pointerStarts.delete(event.pointerId);
		const startX = started?.clientX ?? event.clientX;
		const startY = started?.clientY ?? event.clientY;
		const distancePx = Math.hypot(event.clientX - startX, event.clientY - startY);
		const durationMs = Date.now() - (started?.startedAt ?? Date.now());
		const endTarget = describeInteractionTarget(event);
		void postEvent('pointer_interaction', {
			interactionIntent: distancePx <= 12 ? 'tap' : 'gesture',
			pointerType: event.pointerType || 'unknown',
			pointerId: event.pointerId,
			isPrimary: event.isPrimary,
			button: event.button,
			buttons: event.buttons,
			durationMs,
			distancePx: Math.round(distancePx),
			startClientX: Math.round(startX),
			startClientY: Math.round(startY),
			endClientX: Math.round(event.clientX),
			endClientY: Math.round(event.clientY),
			startPageX: Math.round(started?.pageX ?? event.pageX),
			startPageY: Math.round(started?.pageY ?? event.pageY),
			endPageX: Math.round(event.pageX),
			endPageY: Math.round(event.pageY),
			startTarget: started?.target,
			endTarget,
			targetChanged: started?.target.target !== endTarget.target
		});
	}

	function handleGlobalPointerCancel(event: PointerEvent) {
		const started = pointerStarts.get(event.pointerId);
		pointerStarts.delete(event.pointerId);
		if (!started || !isStudyScreenActive()) return;
		void postEvent('pointer_cancel', {
			pointerType: event.pointerType || 'unknown',
			pointerId: event.pointerId,
			durationMs: Date.now() - started.startedAt,
			startTarget: started.target
		});
	}

	function isIosDevice(): boolean {
		if (!browser) return false;
		return (
			/iPad|iPhone|iPod/.test(navigator.userAgent) ||
			(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
		);
	}

	function isStandaloneWebApp(): boolean {
		if (!browser) return false;
		return (
			window.matchMedia('(display-mode: standalone)').matches ||
			Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
		);
	}

	function notificationSetupIssue(): string {
		if (!browser) return 'Browser not ready.';
		if (!window.isSecureContext) return 'Alerts need HTTPS or localhost.';
		if (!('Notification' in window)) return 'Alerts are not available in this browser.';
		if (!('serviceWorker' in navigator)) return 'Alerts are not available in this browser.';
		if (isIosDevice() && !isStandaloneWebApp())
			return 'On iPhone, open VERDĒ from the Home Screen.';
		return '';
	}

	function notificationSupported(): boolean {
		return browser && !notificationSetupIssue();
	}

	function canRequestNotifications(): boolean {
		return notificationPermission === 'default' && notificationSupported();
	}

	function hapticsSupported(): boolean {
		return browser && 'vibrate' in navigator;
	}

	function audioSupported(): boolean {
		return browser && typeof Audio !== 'undefined';
	}

	function audioVolumeForCue(cue: AudioCue): number {
		if (cue === 'warning') return 0.82;
		if (cue === 'success') return 0.72;
		return 0.58;
	}

	function audioElementForCue(cue: AudioCue): HTMLAudioElement | null {
		if (!audioSupported()) return null;
		if (!audioElements[cue]) {
			const audio = new Audio(audioSources[cue]);
			audio.preload = 'auto';
			audio.volume = audioVolumeForCue(cue);
			audioElements[cue] = audio;
		}
		return audioElements[cue] ?? null;
	}

	function playbackElementForCue(cue: AudioCue): HTMLAudioElement | null {
		if (!audioSupported()) return null;
		if (!cuePlaybackElement) {
			cuePlaybackElement = new Audio();
			cuePlaybackElement.preload = 'auto';
		}
		const sourceUrl = new URL(audioSources[cue], window.location.href).href;
		if (cuePlaybackElement.src !== sourceUrl) {
			cuePlaybackElement.src = sourceUrl;
			cuePlaybackElement.load();
		}
		cuePlaybackElement.volume = audioVolumeForCue(cue);
		return cuePlaybackElement;
	}

	function preloadAudioCues() {
		if (!audioSupported()) return;
		(['neutral', 'success', 'warning'] as AudioCue[]).forEach((cue) => {
			audioElementForCue(cue)?.load();
		});
	}

	async function primeAudio(source: 'startup' | 'gesture' | 'test'): Promise<boolean> {
		if (!audioSupported() || audioUnlocked) return audioUnlocked;
		const audio = playbackElementForCue('neutral');
		if (!audio) return false;
		try {
			audio.pause();
			audio.currentTime = 0;
			audio.volume = audioVolumeForCue('neutral');
			await audio.play();
			audioUnlocked = true;
			void postEvent('audio_unlocked', { source, audioCue: 'neutral' });
			return true;
		} catch (audioError) {
			if (source !== 'startup' && !hasLoggedAudioUnavailable) {
				hasLoggedAudioUnavailable = true;
				void postEvent('audio_unavailable', {
					source,
					audioCue: 'neutral',
					reason: (audioError as Error).name || 'audio_play_failed'
				});
			}
			return false;
		}
	}

	function audioCueForChange(change: AppChange): AudioCue {
		if (session?.activeCondition !== 'aic') return 'neutral';
		if (change.kind === 'phase') {
			if (change.phase === 'delay') return 'warning';
			return 'success';
		}
		if (change.kind === 'trigger') {
			if (
				change.trigger === 'participant_wrong_way' ||
				change.trigger === 'delay_notice_shown' ||
				change.trigger === 'pickup_zone_exit' ||
				change.trigger === 'participant_waiting_zone_exit' ||
				change.trigger === 'boarding_zone_exit' ||
				change.trigger === 'shuttle_arriving_zone_exit'
			) {
				return 'warning';
			}
			return 'success';
		}
		if (change.kind === 'status') {
			return change.status === 'cancelled' ? 'warning' : 'success';
		}
		return change.rideStatus === 'cancelled' ? 'warning' : 'success';
	}

	async function playAudioCue(cue: AudioCue, changeKind: string): Promise<boolean> {
		const audio = playbackElementForCue(cue);
		if (!audio) return false;
		try {
			audio.pause();
			audio.currentTime = 0;
			audio.volume = audioVolumeForCue(cue);
			await audio.play();
			audioUnlocked = true;
			void postEvent('audio_feedback', {
				audioCue: cue,
				audioCondition: session?.activeCondition,
				changeKind,
				visibilityState: document.visibilityState
			});
			return true;
		} catch (audioError) {
			if (!hasLoggedAudioUnavailable) {
				hasLoggedAudioUnavailable = true;
				void postEvent('audio_unavailable', {
					audioCue: cue,
					audioCondition: session?.activeCondition,
					changeKind,
					reason: (audioError as Error).name || 'audio_play_failed'
				});
			}
			return false;
		}
	}

	function participantCueAudio(change: AppChange): AudioCue {
		if (session?.activeCondition !== 'aic') return 'neutral';
		if (change.kind === 'trigger' && change.trigger === 'participant_wrong_way') return 'warning';
		return audioCueForChange(change);
	}

	async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
		if (!notificationSupported()) return null;
		try {
			notificationRegistration = await navigator.serviceWorker.register('/verde-sw.js');
			await navigator.serviceWorker.ready;
			return notificationRegistration;
		} catch {
			notificationRegistration = null;
			return null;
		}
	}

	async function currentNotificationRegistration(): Promise<ServiceWorkerRegistration | null> {
		if (!notificationSupported()) return null;
		if (notificationRegistration) return notificationRegistration;
		return registerServiceWorker();
	}

	async function requestNotificationPermission() {
		if (!notificationSupported()) {
			notificationPermission = 'unsupported';
			feedbackMessage = notificationSetupIssue();
			return;
		}
		try {
			notificationPermission = await Notification.requestPermission();
			await postEvent('notification_permission', { permission: notificationPermission });
			if (notificationPermission === 'granted') {
				await registerServiceWorker();
				feedbackMessage = 'Ride alerts are on.';
			} else {
				feedbackMessage = 'Ride alerts are off.';
			}
		} catch {
			notificationPermission = Notification.permission;
			feedbackMessage = 'Ride alerts are not available here.';
		}
	}

	function getActiveRideOption(): RideOption | undefined {
		if (!session) return undefined;
		const optionId = activeBlock?.selectedRideOptionId;
		return (
			session.scenario.rideOptions.find((option) => option.id === optionId) ??
			session.scenario.rideOptions.find((option) => option.isRecommended) ??
			session.scenario.rideOptions[0]
		);
	}

	function scenarioElapsedSeconds(): number {
		if (!session) return 0;
		const startedAt = session.automation.startedAt
			? new Date(session.automation.startedAt).getTime()
			: undefined;
		return startedAt
			? Math.max(
					0,
					Math.floor((Date.now() - startedAt) / 1000) + session.automation.elapsedBeforePauseSeconds
				)
			: session.automation.elapsedBeforePauseSeconds;
	}

	function remainingPickupMinutes(): number {
		if (!session) return 1;
		const elapsed = scenarioElapsedSeconds();
		const finalPickupSeconds =
			session.scenario.includeDelay && ['delay', 'near_arrival', 'arrival'].includes(session.phase)
				? Math.max(
						session.scenario.timings.arrival,
						session.scenario.timings.delay + session.scenario.revisedEtaSeconds
					)
				: session.scenario.initialEtaSeconds;
		const remainingSeconds = Math.max(0, finalPickupSeconds - elapsed);
		return Math.max(1, Math.ceil(remainingSeconds / 60));
	}

	function assignedVehicleLabel(): string {
		return activeBlock?.rideRequestStatus === 'assigned' && activeRideOption
			? activeRideOption.vehicleId
			: 'the assigned shuttle';
	}

	function triggerLabel(trigger: MapTriggerTag): string {
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
		return labels[trigger];
	}

	function sicAlert(change: AppChange): RideAlert {
		const pickup = activeRideOption?.pickupPoint ?? 'pickup point';
		const eta = remainingPickupMinutes();
		if (change.kind === 'ride_status' && change.rideStatus === 'assigned') {
			return {
				title: 'VERDĒ update',
				body: `Vehicle assigned. Pickup: ${pickup}. ETA: ${eta} min.`,
				tag: 'verde-sic-assigned'
			};
		}
		if (change.kind === 'phase') {
			if (change.phase === 'delay') {
				return {
					title: 'VERDĒ update',
					body: `Delay update. Revised ETA: ${eta} min. Pickup unchanged.`,
					tag: 'verde-sic-delay'
				};
			}
			if (change.phase === 'near_arrival') {
				return {
					title: 'VERDĒ update',
					body: `Shuttle approaching. Pickup: ${pickup}.`,
					tag: 'verde-sic-near'
				};
			}
			if (change.phase === 'arrival') {
				return {
					title: 'VERDĒ update',
					body: `Shuttle arrived. Vehicle: ${assignedVehicleLabel()}.`,
					tag: 'verde-sic-arrival'
				};
			}
			return {
				title: 'VERDĒ update',
				body: `Status changed. Pickup ETA: ${eta} min. Pickup: ${pickup}.`,
				tag: `verde-sic-${change.phase}`
			};
		}
		if (change.kind === 'trigger') {
			if (change.trigger === 'participant_wrong_way') {
				return {
					title: 'VERDĒ update',
					body: `Return to route. Pickup: ${pickup}.`,
					tag: 'verde-sic-wrong-way'
				};
			}
			return {
				title: 'VERDĒ update',
				body: `Route update: ${triggerLabel(change.trigger)}. Pickup: ${pickup}.`,
				tag: `verde-sic-${change.trigger}`
			};
		}
		if (change.kind === 'status') {
			return {
				title: 'VERDĒ update',
				body: `Ride status: ${change.status}.`,
				tag: `verde-sic-${change.status}`
			};
		}
		return {
			title: 'VERDĒ update',
			body: `Ride request status: ${change.rideStatus}.`,
			tag: `verde-sic-${change.rideStatus}`
		};
	}

	function aicAlert(change: AppChange): RideAlert {
		const pickup = activeRideOption?.pickupPoint ?? 'pickup point';
		const eta = remainingPickupMinutes();
		if (change.kind === 'ride_status' && change.rideStatus === 'assigned') {
			return {
				title: `Vehicle ready for ${pickup}`,
				body: `${assignedVehicleLabel()} is assigned. Follow the highlighted route.`,
				tag: 'verde-aic-assigned'
			};
		}
		if (change.kind === 'phase') {
			if (change.phase === 'delay') {
				return {
					title: `Delay: revised pickup in ${eta} min`,
					body: `Pickup stays at ${pickup}. VERDĒ updated the timing.`,
					tag: 'verde-aic-delay'
				};
			}
			if (change.phase === 'near_arrival') {
				return {
					title: 'Shuttle approaching',
					body: `${assignedVehicleLabel()} is approaching ${pickup}. Check the shuttle number.`,
					tag: 'verde-aic-near'
				};
			}
			if (change.phase === 'arrival') {
				return {
					title: `${assignedVehicleLabel()} has arrived`,
					body: `Match the shuttle number. Ride time is ${session?.scenario.rideEtaAfterArrivalMinutes ?? activeRideOption?.rideMinutes ?? 0} min.`,
					tag: 'verde-aic-arrival'
				};
			}
			return {
				title: `Next step: ${change.phase.replace('_', ' ')}`,
				body: `Continue toward ${pickup}. ETA is ${eta} min.`,
				tag: `verde-aic-${change.phase}`
			};
		}
		if (change.kind === 'trigger') {
			if (change.trigger === 'participant_wrong_way') {
				return {
					title: 'Return to route',
					body: `Turn back toward ${pickup} and follow the highlighted path.`,
					tag: 'verde-aic-wrong-way'
				};
			}
			if (
				change.trigger === 'pickup_zone_exit' ||
				change.trigger === 'participant_waiting_zone_exit'
			) {
				return {
					title: 'Return to the pickup area',
					body: `Move back toward ${pickup}. Pickup has not changed.`,
					tag: `verde-aic-${change.trigger}`
				};
			}
			if (change.trigger === 'shuttle_arriving_zone_enter') {
				return {
					title: 'Shuttle approaching',
					body: `Move toward pickup and check ${assignedVehicleLabel()}.`,
					tag: 'verde-aic-shuttle-approach'
				};
			}
			if (
				change.trigger === 'pickup_zone_enter' ||
				change.trigger === 'participant_waiting_zone_enter'
			) {
				return {
					title: 'Wait here for pickup',
					body: `You reached ${pickup}. VERDĒ will guide the next step.`,
					tag: `verde-aic-${change.trigger}`
				};
			}
			if (change.trigger === 'path_area_4_enter') {
				return {
					title: 'You are close to pickup',
					body: `Continue toward ${pickup}.`,
					tag: 'verde-aic-path-area-4'
				};
			}
			if (change.trigger === 'path_area_3_enter') {
				return {
					title: 'Halfway to pickup',
					body: `Keep following the highlighted route toward ${pickup}.`,
					tag: 'verde-aic-path-area-3'
				};
			}
			if (change.trigger === 'path_area_2_enter') {
				return {
					title: 'Keep this path',
					body: `Continue along the current route segment toward ${pickup}.`,
					tag: 'verde-aic-path-area-2'
				};
			}
			if (change.trigger === 'path_area_1_enter') {
				return {
					title: 'Route started',
					body: `Follow the highlighted path toward ${pickup}.`,
					tag: 'verde-aic-path-area-1'
				};
			}
			return {
				title: `Route cue: ${triggerLabel(change.trigger)}`,
				body: `Follow the highlighted path toward ${pickup}.`,
				tag: `verde-aic-${change.trigger}`
			};
		}
		if (change.kind === 'status') {
			return {
				title: 'Ride state changed',
				body: `VERDĒ is now ${change.status}. Keep this screen open.`,
				tag: `verde-aic-${change.status}`
			};
		}
		return {
			title: 'Ride request updated',
			body: `Request is ${change.rideStatus}. VERDĒ will show the next cue.`,
			tag: `verde-aic-${change.rideStatus}`
		};
	}

	function alertForChange(change: AppChange): RideAlert {
		return session?.activeCondition === 'aic' ? aicAlert(change) : sicAlert(change);
	}

	function hapticPatternForChange(change: AppChange): number | number[] {
		if (session?.activeCondition !== 'aic') return 45;
		if (change.kind === 'ride_status' && change.rideStatus === 'assigned') return [45, 35, 45];
		if (change.kind === 'phase') {
			if (change.phase === 'delay') return [90, 45, 90];
			if (change.phase === 'near_arrival') return [45, 35, 80];
			if (change.phase === 'arrival') return [70, 35, 70, 35, 110];
			return [35, 25, 35];
		}
		if (change.kind === 'trigger') {
			if (change.trigger === 'participant_wrong_way') return [100, 45, 100, 45, 60];
			if (change.trigger.includes('exit')) return [80, 35, 45];
			if (change.trigger === 'shuttle_arriving_zone_enter') return [45, 35, 90];
			if (change.trigger === 'boarding_zone_enter') return [35, 25, 35, 25, 70];
			return [28, 22, 28];
		}
		return [35, 25, 35];
	}

	function triggerSignature(tags: MapTriggerTag[] | undefined): string {
		return [...(tags ?? [])].sort().join('|');
	}

	function highestPriorityTrigger(addedTriggers: MapTriggerTag[]): MapTriggerTag | undefined {
		const priority: MapTriggerTag[] = [
			'delay_notice_shown',
			'participant_wrong_way',
			'shuttle_arriving_zone_enter',
			'boarding_zone_enter',
			'pickup_zone_exit',
			'participant_waiting_zone_exit',
			'pickup_zone_enter',
			'participant_waiting_zone_enter',
			'path_area_4_enter',
			'path_area_3_enter',
			'path_area_2_enter',
			'participant_midroute_enter',
			'path_area_1_enter',
			'participant_route_start',
			'revised_eta_acknowledged',
			'boarding_zone_exit',
			'shuttle_arriving_zone_exit'
		];
		return priority.find((trigger) => addedTriggers.includes(trigger)) ?? addedTriggers[0];
	}

	async function deliverNotification(alert: RideAlert, changeKind: string): Promise<boolean> {
		if (!browser || notificationPermission !== 'granted' || !notificationSupported()) return false;
		const options: NotificationOptions = {
			body: alert.body,
			tag: alert.tag,
			icon: '/logo.png',
			badge: '/logo.png',
			data: { url: '/app' }
		};
		try {
			const registration = await currentNotificationRegistration();
			if (registration?.showNotification) {
				await registration.showNotification(alert.title, options);
			} else {
				new Notification(alert.title, options);
			}
			await postEvent('notification_sent', {
				notificationTitle: alert.title,
				notificationTag: alert.tag,
				notificationCondition: session?.activeCondition,
				changeKind,
				visibilityState: document.visibilityState,
				deliveryMethod: registration?.showNotification ? 'service_worker' : 'notification_api'
			});
			return true;
		} catch {
			try {
				new Notification(alert.title, options);
				await postEvent('notification_sent', {
					notificationTitle: alert.title,
					notificationTag: alert.tag,
					notificationCondition: session?.activeCondition,
					changeKind,
					visibilityState: document.visibilityState,
					deliveryMethod: 'notification_api_fallback'
				});
				return true;
			} catch {
				// Browser declined notification delivery; the in-app UI remains the fallback.
			}
		}
		await postEvent('notification_failed', {
			notificationTitle: alert.title,
			notificationTag: alert.tag,
			notificationCondition: session?.activeCondition,
			changeKind,
			setupIssue: notificationSetupIssue()
		});
		return false;
	}

	async function showSystemNotification(alert: RideAlert, change: AppChange) {
		if (!browser || document.visibilityState === 'visible') return;
		await deliverNotification(alert, change.kind);
	}

	async function applyHaptic(change: AppChange) {
		if (!browser || document.visibilityState !== 'visible') return;
		if (!hapticsSupported()) {
			if (!hasLoggedHapticUnavailable) {
				hasLoggedHapticUnavailable = true;
				await postEvent('haptic_unavailable', {
					hapticCondition: session?.activeCondition,
					changeKind: change.kind,
					reason: 'vibration_api_unsupported'
				});
			}
			return;
		}
		const pattern = hapticPatternForChange(change);
		const didVibrate = navigator.vibrate(pattern);
		if (didVibrate) {
			await postEvent('haptic_feedback', {
				hapticCondition: session?.activeCondition,
				changeKind: change.kind,
				pattern
			});
		}
	}

	async function testDeviceFeedback() {
		const notificationIssue = notificationSetupIssue();
		const hasWarningTrigger = Boolean(
			session?.activeTriggerTags?.some((trigger) =>
				[
					'participant_wrong_way',
					'delay_notice_shown',
					'pickup_zone_exit',
					'participant_waiting_zone_exit',
					'boarding_zone_exit',
					'shuttle_arriving_zone_exit'
				].includes(trigger)
			)
		);
		const testAudioCue: AudioCue =
			session?.activeCondition !== 'aic'
				? 'neutral'
				: session.phase === 'delay' || hasWarningTrigger
					? 'warning'
					: 'success';
		await primeAudio('test');
		const audioDelivered = await playAudioCue(testAudioCue, 'device_feedback_test');
		let notificationDelivered = false;
		if (notificationPermission === 'granted' && !notificationIssue) {
			notificationDelivered = await deliverNotification(
				{
					title: session?.activeCondition === 'aic' ? 'VERDĒ test alert' : 'VERDĒ update',
					body:
						session?.activeCondition === 'aic'
							? 'Context alerts are ready.'
							: 'Ride alerts are ready.',
					tag: 'verde-feedback-test'
				},
				'notification_test'
			);
		}
		const hapticDelivered = hapticsSupported() ? navigator.vibrate(45) : false;
		await postEvent('device_feedback_test', {
			audioCue: testAudioCue,
			audioDelivered,
			notificationDelivered,
			hapticDelivered,
			notificationPermission,
			notificationIssue: notificationIssue || undefined,
			audioSupported: audioSupported(),
			hapticsSupported: hapticsSupported()
		});
		if (audioDelivered && notificationDelivered && hapticDelivered) {
			feedbackMessage = 'Sound, alert, and vibration sent.';
		} else if (audioDelivered && notificationDelivered) {
			feedbackMessage = hapticsSupported()
				? 'Sound and alert sent. Vibration may be off.'
				: 'Sound and alert sent. Haptics are not available here.';
		} else if (audioDelivered && hapticDelivered) {
			feedbackMessage = notificationIssue || 'Sound and vibration sent. Ride alerts are off.';
		} else if (audioDelivered) {
			feedbackMessage = notificationIssue || 'Sound played.';
		} else if (notificationDelivered && hapticDelivered) {
			feedbackMessage = 'Alert and vibration sent.';
		} else if (notificationDelivered) {
			feedbackMessage = hapticsSupported()
				? 'Alert sent. Vibration may be off.'
				: 'Alert sent. Haptics are not available here.';
		} else if (hapticDelivered) {
			feedbackMessage = notificationIssue || 'Vibration sent. Ride alerts are off.';
		} else {
			feedbackMessage = notificationIssue || 'Device feedback is not available here.';
		}
	}

	function selectChange(
		previous: NotificationSnapshot,
		next: NotificationSnapshot
	): AppChange | null {
		if (previous.phase !== next.phase) return { kind: 'phase', phase: next.phase };
		if (previous.rideStatus !== next.rideStatus && next.rideStatus === 'assigned') {
			return { kind: 'ride_status', rideStatus: next.rideStatus };
		}
		const previousTriggers = new Set(previous.triggerSignature.split('|').filter(Boolean));
		const nextTriggers = next.triggerSignature.split('|').filter(Boolean) as MapTriggerTag[];
		const addedTrigger = highestPriorityTrigger(
			nextTriggers.filter((trigger) => !previousTriggers.has(trigger))
		);
		if (addedTrigger) return { kind: 'trigger', trigger: addedTrigger };
		if (previous.status !== next.status) return { kind: 'status', status: next.status };
		return null;
	}

	async function handleParticipantCue(change: AppChange) {
		const alert = alertForChange(change);
		await playAudioCue(
			participantCueAudio(change),
			change.kind === 'trigger' ? change.trigger : change.kind
		);
		await applyHaptic(change);
		await showSystemNotification(alert, change);
	}

	async function handleSicBoardingCue(step: SicBoardingStep) {
		const audioDelivered = await playAudioCue('success', `sic_boarding_step_${step}`);
		await postEvent(
			'sic_boarding_audio_cue',
			{
				sicBoardingStep: step,
				audioCue: 'success',
				audioDelivered,
				cueSource: 'participant_app'
			},
			{ allowCompleted: true }
		);
	}

	async function postLiveScroll() {
		if (!isStudyScreenActive()) return;
		const scrollHeight = document.documentElement.scrollHeight;
		const clientHeight = window.innerHeight;
		const maxScroll = Math.max(0, scrollHeight - clientHeight);
		const scrollY = Math.max(0, Math.min(Math.round(window.scrollY), maxScroll));
		await fetch('/api/session/live', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				scroll: {
					scrollY,
					scrollHeight,
					clientHeight,
					scrollPercent: maxScroll > 0 ? scrollY / maxScroll : 0
				}
			})
		}).catch(() => undefined);
	}

	function activeScreenKey(): string {
		if (!session) return 'no-session';
		return `${session.sessionId}:${session.activeBlock}:${session.status}:${session.phase}`;
	}

	function resetAppScrollToTop() {
		if (!browser) return;
		window.requestAnimationFrame(() => {
			window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
			document.documentElement.scrollTop = 0;
			document.body.scrollTop = 0;
			window.requestAnimationFrame(() => void postLiveScroll());
		});
	}

	function applyDebugOverrides(next: StateResponse): StateResponse {
		const condition = page.url.searchParams.get('condition') as Condition | null;
		const phase = page.url.searchParams.get('phase') as StudyPhase | null;
		if (!next.session || (!condition && !phase)) return next;
		return {
			...next,
			session: {
				...next.session,
				activeCondition: condition ?? next.session.activeCondition,
				phase: phase ?? next.session.phase
			}
		};
	}

	function mergeLiveIntoState(next: StateResponse, live = next.live): StateResponse {
		if (!next.session || (!live?.locationOverride && !live?.activeTriggerTags)) return next;
		if (live.sessionId !== next.session.sessionId) return next;
		const liveMatchesCurrentPhase =
			live.block === next.session.activeBlock && live.phase === next.session.phase;
		return {
			...next,
			live,
			session: {
				...next.session,
				locationOverride: live.locationOverride
					? {
							...next.session.locationOverride,
							...live.locationOverride
						}
					: next.session.locationOverride,
				activeTriggerTags:
					liveMatchesCurrentPhase && live.activeTriggerTags
						? live.activeTriggerTags
						: next.session.activeTriggerTags
			}
		};
	}

	function applyLiveLocation(
		locationOverride: LiveLocationBroadcast['locationOverride'],
		activeTriggerTags: MapTriggerTag[] | undefined
	) {
		if (!appState.session) return;
		appState = {
			...appState,
			live: appState.live
				? {
						...appState.live,
						locationOverride: locationOverride
							? {
									...appState.live.locationOverride,
									...locationOverride
								}
							: appState.live.locationOverride,
						activeTriggerTags: activeTriggerTags ?? appState.live.activeTriggerTags,
						updatedAt: new Date().toISOString()
					}
				: appState.live,
			session: {
				...appState.session,
				locationOverride: locationOverride
					? {
							...appState.session.locationOverride,
							...locationOverride
						}
					: appState.session.locationOverride,
				activeTriggerTags: activeTriggerTags ?? appState.session.activeTriggerTags
			}
		};
	}

	function liveLocationChannelForApp(): BroadcastChannel | null {
		if (!browser || typeof BroadcastChannel === 'undefined') return null;
		liveLocationChannel ??= new BroadcastChannel('verde-live-location');
		return liveLocationChannel;
	}

	function applyLiveState(live: SessionLiveState | null | undefined) {
		if (!live || !session || live.sessionId !== session.sessionId) return;
		appState = mergeLiveIntoState(appState, live);
	}

	async function refresh(manual = false) {
		try {
			const response = await fetch(`/api/state?t=${Date.now()}`, {
				cache: 'no-store',
				headers: {
					'cache-control': 'no-cache'
				}
			});
			if (!response.ok) throw new Error('State request failed');
			const nextState = applyDebugOverrides((await response.json()) as StateResponse);
			appState = mergeLiveIntoState(nextState, appState.live ?? nextState.live);
			error = '';
			if (manual) await postEvent('manual_refresh');
		} catch (refreshError) {
			error = (refreshError as Error).message;
		}
	}

	async function refreshLiveState() {
		if (!session) return;
		try {
			const response = await fetch(`/api/session/live?t=${Date.now()}`, {
				cache: 'no-store',
				headers: {
					'cache-control': 'no-cache'
				}
			});
			if (!response.ok) return;
			const payload = (await response.json()) as { live?: SessionLiveState | null };
			applyLiveState(payload.live);
		} catch {
			// Full state polling remains the fallback for temporary live-channel misses.
		}
	}

	async function postSessionUpdate(body: Record<string, unknown>) {
		const response = await fetch('/api/session/update', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
			cache: 'no-store'
		});
		if (!response.ok) {
			const payload = (await response.json().catch(() => ({}))) as { error?: string };
			throw new Error(payload.error ?? 'Session update failed');
		}
		await refresh();
	}

	function handleTrackedTap(target: string, payload: Record<string, unknown> = {}) {
		void postEvent('tap', { target, ...payload });
		if (
			[
				'map_open',
				'map_close',
				'map_exposure',
				'detail_open',
				'detail_close',
				'detail_exposure',
				'detail_action',
				'detail_scroll',
				'map_interaction',
				'ride_option_select',
				'ride_option_auto_select',
				'ride_request',
				'vehicle_details_open',
				'vehicle_details_close',
				'vehicle_details_exposure',
				'eta_details_open',
				'eta_details_close',
				'eta_details_exposure'
			].includes(target)
		) {
			void postEvent(target, payload);
		} else if (target === 'map') {
			void postEvent('map_open', payload);
		}
	}

	async function handleRideOptionChange(
		optionId: string,
		status: RideRequestStatus,
		metadata: Record<string, unknown> = {}
	) {
		try {
			const option = session?.scenario.rideOptions.find((item) => item.id === optionId);
			await postSessionUpdate({
				selectedRideOptionId: optionId,
				rideRequestStatus: status,
				eventType: status === 'requested' ? 'ride_requested' : 'ride_option_selected',
				eventSource: 'participant_app',
				payload: {
					screen: 'app',
					...clientEventContext(),
					...metadata,
					optionId,
					rideRequestStatus: status,
					optionLabel: option?.label,
					pickupPoint: option?.pickupPoint,
					destination: option?.destination,
					waitMinutes: option?.waitMinutes,
					walkMinutes: option?.walkMinutes,
					rideMinutes: option?.rideMinutes,
					arrivalTime: option?.arrivalTime,
					vehicleId: option?.vehicleId,
					isRecommended: Boolean(option?.isRecommended)
				}
			});
			error = '';
		} catch (updateError) {
			error = (updateError as Error).message;
		}
	}

	$effect(() => {
		if (!browser) return;
		notificationPermission = notificationSupported() ? Notification.permission : 'unsupported';
		if (notificationPermission === 'granted') void registerServiceWorker();
		preloadAudioCues();
		void primeAudio('startup');
		void refresh();
		const interval = window.setInterval(() => void refresh(), 1000);
		const liveInterval = window.setInterval(() => void refreshLiveState(), 200);
		const channel = liveLocationChannelForApp();
		const handleLiveLocationMessage = (event: MessageEvent<LiveLocationBroadcast>) => {
			const message = event.data;
			if (message?.type !== 'verde_live_location') return;
			if (!session || message.sessionId !== session.sessionId) return;
			applyLiveLocation(message.locationOverride, message.activeTriggerTags);
		};
		channel?.addEventListener('message', handleLiveLocationMessage);
		if (typeof EventSource !== 'undefined') {
			liveEventSource = new EventSource('/api/session/live/stream');
			liveEventSource.onmessage = (event) => {
				try {
					const payload = JSON.parse(event.data) as { live?: SessionLiveState | null };
					applyLiveState(payload.live);
				} catch {
					// Ignore malformed live stream events; polling remains the fallback.
				}
			};
			liveEventSource.onerror = () => {
				void refreshLiveState();
			};
		}
		const handleAudioUnlock = () => void primeAudio('gesture');
		const handleVisibility = () => {
			postEventBeacon('app_visibility', { visibilityState: document.visibilityState });
			if (document.visibilityState === 'visible') void refresh();
		};
		const handlePageHide = () => {
			postEventBeacon('app_pagehide', { visibilityState: document.visibilityState });
		};
		const handleForegroundRefresh = () => void refresh();
		const handleScroll = () => {
			const now = Date.now();
			if (now - lastLiveScrollSentAt >= 180) {
				lastLiveScrollSentAt = now;
				void postLiveScroll();
			}
			if (now - lastScrollLoggedAt < 1500) return;
			lastScrollLoggedAt = now;
			void postEvent('scroll', {
				scrollY: Math.round(window.scrollY),
				viewportHeight: window.innerHeight,
				documentHeight: document.documentElement.scrollHeight
			});
		};
		window.addEventListener('pointerdown', handleAudioUnlock, { once: true, passive: true });
		window.addEventListener('pointerdown', handleGlobalPointerDown, {
			capture: true,
			passive: true
		});
		window.addEventListener('pointerup', handleGlobalPointerUp, { capture: true, passive: true });
		window.addEventListener('pointercancel', handleGlobalPointerCancel, {
			capture: true,
			passive: true
		});
		window.addEventListener('touchstart', handleAudioUnlock, { once: true, passive: true });
		window.addEventListener('keydown', handleAudioUnlock, { once: true });
		document.addEventListener('visibilitychange', handleVisibility);
		window.addEventListener('pagehide', handlePageHide);
		window.addEventListener('focus', handleForegroundRefresh);
		window.addEventListener('pageshow', handleForegroundRefresh);
		window.addEventListener('online', handleForegroundRefresh);
		window.addEventListener('scroll', handleScroll, { passive: true });
		return () => {
			window.clearInterval(interval);
			window.clearInterval(liveInterval);
			liveEventSource?.close();
			liveEventSource = null;
			channel?.removeEventListener('message', handleLiveLocationMessage);
			channel?.close();
			liveLocationChannel = null;
			window.removeEventListener('pointerdown', handleAudioUnlock);
			window.removeEventListener('pointerdown', handleGlobalPointerDown, { capture: true });
			window.removeEventListener('pointerup', handleGlobalPointerUp, { capture: true });
			window.removeEventListener('pointercancel', handleGlobalPointerCancel, { capture: true });
			window.removeEventListener('touchstart', handleAudioUnlock);
			window.removeEventListener('keydown', handleAudioUnlock);
			document.removeEventListener('visibilitychange', handleVisibility);
			window.removeEventListener('pagehide', handlePageHide);
			window.removeEventListener('focus', handleForegroundRefresh);
			window.removeEventListener('pageshow', handleForegroundRefresh);
			window.removeEventListener('online', handleForegroundRefresh);
			window.removeEventListener('scroll', handleScroll);
		};
	});

	$effect(() => {
		if (!session) return;
		if (!isStudyScreenActive()) {
			hasLoggedInitialVisit = false;
			lastPhase = null;
			lastScreenKey = '';
			return;
		}
		const screenKey = activeScreenKey();
		if (!hasLoggedInitialVisit) {
			hasLoggedInitialVisit = true;
			lastPhase = session.phase;
			lastScreenKey = screenKey;
			lastPhaseEnteredAt = Date.now();
			resetAppScrollToTop();
			void postEvent('screen_visit', { phase: session.phase });
			return;
		}
		if (screenKey !== lastScreenKey) {
			lastScreenKey = screenKey;
			resetAppScrollToTop();
		}
		if (lastPhase && session.phase !== lastPhase) {
			const durationSeconds = Math.round((Date.now() - lastPhaseEnteredAt) / 1000);
			void postEvent('phase_exposure', { phase: lastPhase, durationSeconds });
			void postEvent('screen_visit', { phase: session.phase });
			lastPhase = session.phase;
			lastPhaseEnteredAt = Date.now();
		}
	});

	$effect(() => {
		if (!browser || !session || !isStudyScreenActive()) {
			notificationSnapshot = null;
			return;
		}
		const nextSnapshot: NotificationSnapshot = {
			sessionId: session.sessionId,
			block: session.activeBlock,
			phase: session.phase,
			status: session.status,
			rideStatus: activeBlock?.rideRequestStatus ?? 'none',
			triggerSignature: triggerSignature(session.activeTriggerTags)
		};
		if (
			!notificationSnapshot ||
			notificationSnapshot.sessionId !== nextSnapshot.sessionId ||
			notificationSnapshot.block !== nextSnapshot.block
		) {
			notificationSnapshot = nextSnapshot;
			return;
		}
		const change = selectChange(notificationSnapshot, nextSnapshot);
		notificationSnapshot = nextSnapshot;
		if (change) {
			window.requestAnimationFrame(() => {
				void handleParticipantCue(change);
			});
		}
	});

	$effect(() => {
		if (
			!browser ||
			!session ||
			session.status === 'study_finished' ||
			session.status === 'cancelled'
		) {
			boardingCueSnapshot = null;
			return;
		}
		const nextSnapshot: BoardingCueSnapshot = {
			sessionId: session.sessionId,
			block: session.activeBlock,
			phase: session.phase,
			status: session.status,
			sicBoardingStep: session.sicBoardingStep
		};
		if (
			!boardingCueSnapshot ||
			boardingCueSnapshot.sessionId !== nextSnapshot.sessionId ||
			boardingCueSnapshot.block !== nextSnapshot.block
		) {
			boardingCueSnapshot = nextSnapshot;
			return;
		}
		const previousStep = boardingCueSnapshot.sicBoardingStep;
		boardingCueSnapshot = nextSnapshot;
		if (
			nextSnapshot.phase !== 'arrival' ||
			!nextSnapshot.sicBoardingStep ||
			previousStep === nextSnapshot.sicBoardingStep
		) {
			return;
		}
		window.requestAnimationFrame(() => {
			void handleSicBoardingCue(nextSnapshot.sicBoardingStep as SicBoardingStep);
		});
	});
</script>

<svelte:head>
	<title>VERDĒ</title>
	<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
</svelte:head>

<main>
	{#if error}
		<section class="grid min-h-dvh place-items-center bg-canvas-mist px-6 text-center">
			<div class="verde-card max-w-sm p-8">
				<p class="text-xs font-bold tracking-[0.18em] text-critical uppercase">Connection paused</p>
				<h1 class="mt-4 text-2xl font-bold text-forest">VERDĒ is reconnecting</h1>
				<p class="mt-3 text-sm leading-6 text-corduroy">Keep this screen open.</p>
				<button
					class="verde-focus mt-6 rounded-full bg-forest px-5 py-3 text-sm font-bold text-white"
					onclick={() => void refresh(true)}
				>
					Try again
				</button>
				<p class="mt-4 text-xs text-critical">{error}</p>
			</div>
		</section>
	{:else if session}
		<ParticipantRide
			{session}
			{map}
			onTrackedTap={handleTrackedTap}
			onRideOptionChange={handleRideOptionChange}
		/>
	{:else}
		<section class="grid min-h-dvh place-items-center bg-canvas-mist px-6 text-center">
			<div class="verde-card max-w-sm p-8">
				<p class="text-[0.72rem] font-bold tracking-[0.32em] text-forest">V E R D Ē</p>
				<h1 class="mt-4 text-2xl font-bold text-forest">Waiting for ride</h1>
				<p class="mt-3 text-sm leading-6 text-corduroy">Your ride will appear here.</p>
				<button
					class="verde-focus mt-6 rounded-full bg-forest px-5 py-3 text-sm font-bold text-white"
					onclick={() => void refresh(true)}
				>
					Refresh
				</button>
				<!-- <div
					class="mt-5 rounded-[24px] border border-[var(--hairline)] bg-canvas-mist p-4 text-left"
				>
					<p class="text-sm font-bold text-forest">Device check</p>
					<p class="mt-1 text-xs leading-5 text-corduroy">
						Check sound and alerts before the ride.
					</p>
					<div class="mt-4 grid gap-2 text-xs font-semibold">
						<div class="flex items-start justify-between gap-3 rounded-2xl bg-white px-3 py-2">
							<span class="text-corduroy">Ride alerts</span>
							<span class="text-right text-forest">
								{notificationPermission === 'granted'
									? 'Enabled'
									: notificationSetupIssue()
										? 'Unavailable'
										: 'Not enabled'}
							</span>
						</div>
						<div class="flex items-start justify-between gap-3 rounded-2xl bg-white px-3 py-2">
							<span class="text-corduroy">In-app haptics</span>
							<span class="text-right text-forest"
								>{hapticsSupported() ? 'Available' : 'Unavailable'}</span
							>
						</div>
						<div class="flex items-start justify-between gap-3 rounded-2xl bg-white px-3 py-2">
							<span class="text-corduroy">In-app audio</span>
							<span class="text-right text-forest"
								>{audioSupported() ? 'Available' : 'Unavailable'}</span
							>
						</div>
					</div>
					{#if notificationSetupIssue()}
						<p class="mt-3 text-xs leading-5 text-critical">{notificationSetupIssue()}</p>
					{:else if canRequestNotifications()}
						<button
							class="verde-focus mt-3 rounded-full bg-forest px-4 py-2 text-xs font-bold text-white"
							onclick={requestNotificationPermission}
						>
							Enable alerts
						</button>
					{:else if notificationPermission === 'denied'}
						<p class="mt-3 text-xs leading-5 text-critical">
							Ride alerts are blocked. Enable notifications for VERDĒ, then reopen the app.
						</p>
					{/if}
					<div class="mt-3 flex flex-wrap gap-2">
						<button
							class="verde-focus rounded-full bg-white px-4 py-2 text-xs font-bold text-forest disabled:opacity-40"
							disabled={notificationPermission !== 'granted' &&
								!hapticsSupported() &&
								!audioSupported()}
							onclick={() => void testDeviceFeedback()}
						>
							Test feedback
						</button>
						{#if notificationPermission === 'granted'}
							<span class="rounded-full bg-mint px-3 py-2 text-xs font-bold text-forest"
								>Alerts ready</span
							>
						{/if}
					</div>
					{#if feedbackMessage}
						<p class="mt-3 text-xs leading-5 text-corduroy">{feedbackMessage}</p>
					{/if}
				</div> -->
				{#if error}<p class="mt-4 text-xs text-critical">{error}</p>{/if}
			</div>
		</section>
	{/if}
</main>
