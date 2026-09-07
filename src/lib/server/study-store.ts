import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as YAML from 'yaml';
import type {
	BlockState,
	Condition,
	ConditionOrder,
	LocationOverride,
	MapObjectType,
	MapTriggerTag,
	ParticipantRecord,
	ParticipantSummary,
	RideRequestStatus,
	ScenarioConfig,
	SessionLiveState,
	SicBoardingStep,
	StateResponse,
	StudyEvent,
	StudyMapInitialView,
	StudyMap,
	StudyMapObject,
	StudyMapViewport,
	StudyMapViewportKey,
	StudyPhase,
	StudySession
} from '$lib/types';

const dataRoot = path.join(process.cwd(), 'data');
const participantsDir = path.join(dataRoot, 'participants');
const mapsDir = path.join(dataRoot, 'maps');
const sessionDir = path.join(dataRoot, 'session');
const configDir = path.join(dataRoot, 'config');
const sessionFile = path.join(sessionDir, 'active-session.json');
const defaultScenarioFile = path.join(configDir, 'default-scenario.yml');
let liveState: SessionLiveState | null = null;
const liveStateSubscribers = new Set<(state: SessionLiveState) => void>();
let writeSequence = 0;
const fileWriteQueues = new Map<string, Promise<void>>();
let sessionMutationQueue: Promise<unknown> = Promise.resolve();
const shuttleProgressLimit = 1;
const shuttleArrivingZoneBuffer = 0;
const shuttleStopAfterArrivingZoneExitPx = 50;
const wrongWayRouteBufferPx = 50;
const assignmentVehicleFocusBufferSeconds = 5;
const defaultParticipantMapId = 'default-map';
const directRideOptionId = 'verde-direct';
const sicBoardingStepValues = new Set<SicBoardingStep>([1, 2, 3, 4]);

type Point = { x: number; y: number };

const defaultRideOptions: ScenarioConfig['rideOptions'] = [
	{
		id: 'verde-direct',
		label: 'Direct pickup',
		pickupPoint: 'THI Main Stop',
		destination: 'Mobility Lab',
		waitMinutes: 3,
		walkMinutes: 1,
		rideMinutes: 6,
		arrivalTime: '09:12',
		vehicleType: 'Autonomous shuttle',
		vehicleId: 'Shuttle-4',
		occupancy: '2 seats free',
		co2SavedKg: 1.2,
		batteryPercent: 82,
		comfort: 'Quiet cabin',
		routeSummary: 'Short walk. Direct route.',
		recommendationReason: 'Closest pickup for this ride.',
		tags: ['Closest pickup', 'Direct route'],
		isRecommended: true
	},
	{
		id: 'verde-sheltered',
		label: 'Sheltered pickup',
		pickupPoint: 'Campus East Stop',
		destination: 'Mobility Lab',
		waitMinutes: 4,
		walkMinutes: 2,
		rideMinutes: 5,
		arrivalTime: '09:13',
		vehicleType: 'Autonomous shuttle',
		vehicleId: 'Shuttle-2',
		occupancy: '3 seats free',
		co2SavedKg: 1.1,
		batteryPercent: 76,
		comfort: 'Covered waiting area',
		routeSummary: 'A little more walking. Covered stop.',
		recommendationReason: 'More cover while you wait.',
		tags: ['Covered pickup', 'Balanced']
	},
	{
		id: 'verde-shared',
		label: 'Shared campus loop',
		pickupPoint: 'Northwest Shuttle Stop',
		destination: 'Mobility Lab',
		waitMinutes: 5,
		walkMinutes: 3,
		rideMinutes: 7,
		arrivalTime: '09:16',
		vehicleType: 'Autonomous shuttle',
		vehicleId: 'Shuttle-3',
		occupancy: '1 seat free',
		co2SavedKg: 1.5,
		batteryPercent: 88,
		comfort: 'Shared ride',
		routeSummary: 'Shared route with one campus stop.',
		recommendationReason: 'Lower impact, with a later arrival.',
		tags: ['Lower impact', 'Shared']
	}
];

const defaultScenario: ScenarioConfig = {
	durationSeconds: 300,
	includeDelay: true,
	initialEtaSeconds: 200,
	revisedEtaSeconds: 200,
	selectionCountdownSeconds: 90,
	assignmentDurationSeconds: 30,
	arrivalCompletionBufferSeconds: 15,
	rideEtaAfterArrivalMinutes: 6,
	timings: {
		delay: 100,
		near_arrival: 260,
		arrival: 300
	},
	phaseCopy: {
		ready: {
			eyebrow: 'VERDĒ',
			title: 'Waiting for ride',
			body: 'Your ride will appear here.'
		},
		offline: {
			eyebrow: 'Connection paused',
			title: 'VERDĒ is reconnecting',
			body: 'Keep this screen open.'
		},
		booking: {
			eyebrow: 'Plan your ride',
			title: 'Choose your shuttle',
			body: 'Choose the pickup that fits this trip.'
		},
		assignment: {
			eyebrow: 'Assignment',
			title: 'Finding your shuttle',
			body: 'VERDĒ is confirming the vehicle, pickup, and route.'
		},
		waiting: {
			eyebrow: 'On the way',
			title: 'Go to pickup',
			body: 'Follow the route and wait at the stop.'
		},
		delay: {
			eyebrow: 'Timing',
			title: 'Pickup time changed',
			body: 'The pickup stays the same.'
		},
		near_arrival: {
			eyebrow: 'Shuttle is approaching',
			title: 'Shuttle approaching',
			body: 'Check the shuttle number when it stops.'
		},
		arrival: {
			eyebrow: 'Shuttle is arriving',
			title: 'Shuttle here',
			body: 'Match the vehicle number before you continue.'
		},
		block_finished: {
			eyebrow: 'VERDĒ',
			title: 'Block finished',
			body: 'Keep this screen open.'
		},
		study_finished: {
			eyebrow: 'VERDĒ',
			title: 'All set',
			body: 'This ride flow is complete. Please return the phone to the researcher.'
		}
	},
	microUpdates: {
		booking: ['Pickup options ready.', 'Shuttles checked.'],
		assignment: ['Request received.', 'Finding shuttle.', 'Confirming route.'],
		waiting: ['Shuttle on the way.', 'Route updated.', 'Pickup unchanged.'],
		delay: ['Timing changed.', 'ETA updated.', 'Pickup unchanged.'],
		near_arrival: ['Shuttle approaching.', 'Check shuttle number.', 'Stay at the stop.'],
		arrival: ['Shuttle arrived.', 'Vehicle check ready.']
	},
	vehicleIdentifiers: ['Vehicle ID', 'Vehicle type'],
	supportMock: {
		label: 'Contact support',
		body: 'Support noted. Keep this screen open.',
		cancelLabel: 'Ask about cancelling'
	},
	rideOptions: defaultRideOptions
};

const staleScenarioCopyFragments = [
	'Waiting for ride setup',
	'VERDĒ cannot reach the shuttle service',
	'Compare pickup',
	'Vehicle assignment',
	'Matching your shuttle',
	'Your shuttle is being assigned',
	'Updated shuttle timing',
	'VERDĒ user study',
	'user study',
	'researcher',
	'Ask support about cancellation',
	'Shortest walk with standard campus routing',
	'Slightly longer walk with a sheltered pickup point',
	'Lower-impact route with one shared stop',
	'Closest pickup and fastest boarding',
	'Better waiting comfort with similar arrival time',
	'Highest CO₂ saving',
	'Fast boarding'
];

function hasStaleScenarioCopy(value: unknown): boolean {
	if (typeof value === 'string') {
		return staleScenarioCopyFragments.some((fragment) => value.includes(fragment));
	}
	if (Array.isArray(value)) return value.some((item) => hasStaleScenarioCopy(item));
	if (value && typeof value === 'object') {
		return Object.values(value).some((item) => hasStaleScenarioCopy(item));
	}
	return false;
}

function normalizeScenarioCopy<T extends Record<string, unknown>>(
	current: Partial<T>,
	defaults: T
): T {
	const entries = Object.entries({ ...defaults, ...current }).map(([key, value]) => [
		key,
		hasStaleScenarioCopy(value) ? defaults[key] : value
	]);
	return Object.fromEntries(entries) as T;
}

function normalizeRideOptionCopy(option: ScenarioConfig['rideOptions'][number]) {
	const defaultOption = defaultRideOptions.find((item) => item.id === option.id);
	if (!defaultOption) return option;
	return {
		...option,
		routeSummary: hasStaleScenarioCopy(option.routeSummary)
			? defaultOption.routeSummary
			: option.routeSummary,
		recommendationReason: hasStaleScenarioCopy(option.recommendationReason)
			? defaultOption.recommendationReason
			: option.recommendationReason,
		tags: hasStaleScenarioCopy(option.tags) ? defaultOption.tags : option.tags
	};
}

function nowIso(): string {
	return new Date().toISOString();
}

function makeId(prefix: string): string {
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function safeFilename(value: string): string {
	const safe = value
		.trim()
		.replace(/[^a-zA-Z0-9._-]+/g, '_')
		.replace(/^_+|_+$/g, '');
	return safe.length > 0 ? safe : 'participant';
}

function participantPath(participantId: string): string {
	return path.join(participantsDir, `${safeFilename(participantId)}.json`);
}

function mapPath(mapId: string): string {
	return path.join(mapsDir, `${safeFilename(mapId)}.json`);
}

function conditionPair(order: ConditionOrder): [Condition, Condition] {
	return order === 'SIC_AIC' ? ['sic', 'aic'] : ['aic', 'sic'];
}

async function loadDefaultScenario(): Promise<ScenarioConfig> {
	try {
		const parsed = YAML.parse(
			await readFile(defaultScenarioFile, 'utf-8')
		) as Partial<ScenarioConfig>;
		return normalizeScenario(parsed);
	} catch {
		return defaultScenario;
	}
}

export async function getDefaultScenarioConfig(): Promise<ScenarioConfig> {
	return loadDefaultScenario();
}

function initialMap(id: string, name: string, roomLabel: string): StudyMap {
	const timestamp = nowIso();
	const objects: StudyMapObject[] = [
		{
			id: makeId('zone'),
			type: 'zone',
			label: 'Waiting area',
			x: 58,
			y: 62,
			width: 270,
			height: 178
		},
		{
			id: makeId('wall'),
			type: 'wall',
			label: 'North wall',
			x: 44,
			y: 44,
			x2: 350,
			y2: 44,
			size: 5
		},
		{
			id: makeId('wall'),
			type: 'wall',
			label: 'West wall',
			x: 44,
			y: 44,
			x2: 44,
			y2: 278,
			size: 5
		},
		{
			id: makeId('wall'),
			type: 'wall',
			label: 'South wall',
			x: 44,
			y: 278,
			x2: 350,
			y2: 278,
			size: 5
		},
		{
			id: makeId('path'),
			type: 'path',
			label: 'Route to pickup',
			x: 96,
			y: 224,
			x2: 294,
			y2: 94,
			size: 6
		},
		{
			id: makeId('shuttle_path'),
			type: 'shuttle_path',
			label: 'Shuttle approach route',
			x: 330,
			y: 72,
			x2: 294,
			y2: 94,
			size: 7
		},
		{
			id: makeId('participant'),
			type: 'participant_start',
			label: 'Participant start',
			x: 96,
			y: 224,
			size: 11
		},
		{
			id: makeId('current'),
			type: 'current_location',
			label: 'Current Location',
			x: 150,
			y: 186,
			size: 11
		},
		{ id: makeId('pickup'), type: 'pickup', label: 'Pickup Point A', x: 294, y: 94, size: 11 },
		{ id: makeId('pickup'), type: 'pickup', label: 'Pickup Point B', x: 300, y: 238, size: 11 },
		{ id: makeId('shuttle'), type: 'shuttle', label: 'Shuttle-4', x: 330, y: 72, size: 15 },
		{
			id: makeId('obstacle'),
			type: 'obstacle',
			label: 'Door swing',
			x: 212,
			y: 132,
			width: 48,
			height: 34
		},
		{ id: makeId('label'), type: 'label', label: roomLabel, x: 62, y: 32, size: 13 }
	];

	return {
		id,
		name,
		roomLabel,
		width: 390,
		height: 320,
		initialViewport: 'default',
		initialView: { viewport: 'default', zoom: 1, panX: 0, panY: 0 },
		viewports: defaultMapViewports(390, 320),
		objects,
		createdAt: timestamp,
		updatedAt: timestamp
	};
}

function defaultMapViewports(
	width: number,
	height: number
): Record<StudyMapViewportKey, StudyMapViewport> {
	return {
		default: { x: 0, y: 0, width, height, label: 'Default view' },
		expanded: { x: 0, y: 0, width, height, label: 'Expanded view' }
	};
}

function normalizeViewport(
	viewport: Partial<StudyMapViewport> | undefined,
	fallback: StudyMapViewport
): StudyMapViewport {
	const width = Math.max(1, Number(viewport?.width ?? fallback.width));
	const height = Math.max(1, Number(viewport?.height ?? fallback.height));
	return {
		x: Number(viewport?.x ?? fallback.x),
		y: Number(viewport?.y ?? fallback.y),
		width,
		height,
		label: viewport?.label ?? fallback.label
	};
}

function normalizeInitialView(map: StudyMap): StudyMapInitialView {
	const viewport: StudyMapViewportKey =
		map.initialView?.viewport === 'expanded' || map.initialViewport === 'expanded'
			? 'expanded'
			: 'default';
	return {
		viewport,
		zoom: Math.min(4, Math.max(1, Number(map.initialView?.zoom ?? 1))),
		panX: Number(map.initialView?.panX ?? 0),
		panY: Number(map.initialView?.panY ?? 0)
	};
}

function normalizeMap(map: StudyMap): StudyMap {
	const viewports = defaultMapViewports(map.width, map.height);
	const initialView = normalizeInitialView(map);
	const initialViewport = initialView.viewport;
	return {
		...map,
		initialViewport,
		initialView,
		viewports: {
			default: normalizeViewport(map.viewports?.default, viewports.default),
			expanded: normalizeViewport(map.viewports?.expanded, viewports.expanded)
		}
	};
}

function mapsNeedMetadataMigration(original: StudyMap, normalized: StudyMap): boolean {
	if (original.initialViewport !== normalized.initialViewport) return true;
	if (
		original.initialView?.viewport !== normalized.initialView?.viewport ||
		original.initialView?.zoom !== normalized.initialView?.zoom ||
		original.initialView?.panX !== normalized.initialView?.panX ||
		original.initialView?.panY !== normalized.initialView?.panY
	)
		return true;
	if (!original.viewports?.default || !original.viewports?.expanded) return true;
	return (
		original.viewports.default.x !== normalized.viewports?.default.x ||
		original.viewports.default.y !== normalized.viewports?.default.y ||
		original.viewports.default.width !== normalized.viewports?.default.width ||
		original.viewports.default.height !== normalized.viewports?.default.height ||
		original.viewports.expanded.x !== normalized.viewports?.expanded.x ||
		original.viewports.expanded.y !== normalized.viewports?.expanded.y ||
		original.viewports.expanded.width !== normalized.viewports?.expanded.width ||
		original.viewports.expanded.height !== normalized.viewports?.expanded.height
	);
}

async function migrateMapMetadata(): Promise<void> {
	const files = (await readdir(mapsDir)).filter((file) => file.endsWith('.json'));
	await Promise.all(
		files.map(async (file) => {
			const filePath = path.join(mapsDir, file);
			const map = await readJson<StudyMap>(filePath);
			if (!map) return;
			const normalized = normalizeMap(map);
			if (mapsNeedMetadataMigration(map, normalized)) {
				await writeJson(filePath, normalized);
			}
		})
	);
}

async function ensureData(): Promise<void> {
	await mkdir(participantsDir, { recursive: true });
	await mkdir(mapsDir, { recursive: true });
	await mkdir(sessionDir, { recursive: true });
	await mkdir(configDir, { recursive: true });

	const maps = await readdir(mapsDir);
	if (!maps.some((file) => file.endsWith('.json'))) {
		const roomOne = initialMap('room-1-map', 'Room 1 Map', 'THI Study Room 1');
		const roomTwo = initialMap('room-2-map', 'Room 2 Map', 'THI Study Room 2');
		await writeJson(mapPath(roomOne.id), roomOne);
		await writeJson(mapPath(roomTwo.id), roomTwo);
	}
	await migrateMapMetadata();
}

async function readJson<T>(filePath: string): Promise<T | null> {
	try {
		return JSON.parse(await readFile(filePath, 'utf-8')) as T;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
		if (error instanceof SyntaxError) {
			const recovered = await recoverJson<T>(filePath);
			if (recovered) return recovered;
			await quarantineJson(filePath);
			return null;
		}
		throw error;
	}
}

async function writeJsonNow(filePath: string, value: unknown): Promise<void> {
	const body = `${JSON.stringify(value, null, 2)}\n`;
	const sequence = (writeSequence += 1);
	const tempPath = `${filePath}.${process.pid}.${Date.now()}.${sequence}.${randomUUID()}.tmp`;
	try {
		await writeFile(tempPath, body, 'utf-8');
		await rename(tempPath, filePath);
	} catch (error) {
		await unlink(tempPath).catch(() => undefined);
		throw error;
	}
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
	const previous = fileWriteQueues.get(filePath) ?? Promise.resolve();
	const current = previous.then(() => writeJsonNow(filePath, value));
	fileWriteQueues.set(
		filePath,
		current.finally(() => {
			if (fileWriteQueues.get(filePath) === current) fileWriteQueues.delete(filePath);
		})
	);
	return current;
}

async function withSessionMutation<T>(operation: () => Promise<T>): Promise<T> {
	const current = sessionMutationQueue.then(operation, operation);
	sessionMutationQueue = current.catch(() => undefined);
	return current;
}

function firstJsonObject(text: string): string | null {
	let depth = 0;
	let start = -1;
	let inString = false;
	let escaped = false;

	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (char === '\\') {
				escaped = true;
			} else if (char === '"') {
				inString = false;
			}
			continue;
		}

		if (char === '"') {
			inString = true;
		} else if (char === '{') {
			if (depth === 0) start = index;
			depth += 1;
		} else if (char === '}') {
			depth -= 1;
			if (depth === 0 && start >= 0) return text.slice(start, index + 1);
			if (depth < 0) return null;
		}
	}

	return null;
}

async function recoverJson<T>(filePath: string): Promise<T | null> {
	const raw = await readFile(filePath, 'utf-8');
	const firstObject = firstJsonObject(raw);
	if (!firstObject) return null;

	try {
		const parsed = JSON.parse(firstObject) as T;
		const backupPath = `${filePath}.corrupt-${Date.now()}`;
		await writeFile(backupPath, raw, 'utf-8');
		await writeJson(filePath, parsed);
		return parsed;
	} catch {
		return null;
	}
}

async function quarantineJson(filePath: string): Promise<void> {
	try {
		const raw = await readFile(filePath, 'utf-8');
		const backupPath = `${filePath}.corrupt-${Date.now()}`;
		await writeFile(backupPath, raw, 'utf-8');
		await writeJson(filePath, null);
	} catch {
		// If quarantine fails, keep the API resilient and let the caller continue without this file.
	}
}

function makeEvent(
	session: StudySession | null,
	type: string,
	source: StudyEvent['source'],
	payload?: Record<string, unknown>
): StudyEvent {
	return {
		id: makeId('event'),
		timestamp: nowIso(),
		participantId: session?.participantId,
		block: session?.activeBlock,
		condition: session?.activeCondition,
		phase: session?.phase,
		screen: typeof payload?.screen === 'string' ? payload.screen : undefined,
		type,
		source,
		payload
	};
}

function elapsedSeconds(automation: StudySession['automation']): number {
	if (!automation.startedAt) return automation.elapsedBeforePauseSeconds;
	const started = new Date(automation.startedAt).getTime();
	return Math.max(
		0,
		Math.floor((Date.now() - started) / 1000) + automation.elapsedBeforePauseSeconds
	);
}

function pickupCode(value: string): string {
	return value.match(/pickup\s*(point\s*)?([a-z])/i)?.[2]?.toLowerCase() ?? '';
}

function selectedPickupObject(map: StudyMap, session: StudySession): StudyMapObject | undefined {
	const activeBlock = session.blocks.find((block) => block.block === session.activeBlock);
	const selectedOption =
		session.scenario.rideOptions.find(
			(option) => option.id === activeBlock?.selectedRideOptionId
		) ??
		session.scenario.rideOptions.find((option) => option.isRecommended) ??
		session.scenario.rideOptions[0];
	const pickups = map.objects.filter((object) => object.type === 'pickup');
	const selectedCode = pickupCode(selectedOption?.pickupPoint ?? '');
	return pickups.find((object) => pickupCode(object.label) === selectedCode) ?? pickups[0];
}

function distance(from: Point, to: Point): number {
	return Math.hypot(to.x - from.x, to.y - from.y);
}

function pushPoint(points: Point[], point: Point): void {
	const previous = points.at(-1);
	if (!previous || distance(previous, point) > 1) points.push(point);
}

function routePointsFor(
	map: StudyMap,
	pathType: 'path' | 'shuttle_path',
	startObject: StudyMapObject,
	targetObject: StudyMapObject | undefined
): Point[] {
	const pathObjects = [...map.objects.filter((object) => object.type === pathType)];
	const points: Point[] = [{ x: startObject.x, y: startObject.y }];

	if (pathObjects.length === 0) {
		if (targetObject) pushPoint(points, { x: targetObject.x, y: targetObject.y });
		return points;
	}

	let cursor: Point = { x: startObject.x, y: startObject.y };
	while (pathObjects.length > 0) {
		let bestIndex = 0;
		let bestReversed = false;
		let bestDistance = Number.POSITIVE_INFINITY;

		for (const [index, pathObject] of pathObjects.entries()) {
			const startDistance = distance(cursor, { x: pathObject.x, y: pathObject.y });
			const endDistance = distance(cursor, {
				x: pathObject.x2 ?? pathObject.x,
				y: pathObject.y2 ?? pathObject.y
			});
			if (startDistance < bestDistance) {
				bestDistance = startDistance;
				bestIndex = index;
				bestReversed = false;
			}
			if (endDistance < bestDistance) {
				bestDistance = endDistance;
				bestIndex = index;
				bestReversed = true;
			}
		}

		const [pathObject] = pathObjects.splice(bestIndex, 1);
		const routeStart = bestReversed
			? { x: pathObject.x2 ?? pathObject.x, y: pathObject.y2 ?? pathObject.y }
			: { x: pathObject.x, y: pathObject.y };
		const routeEnd = bestReversed
			? { x: pathObject.x, y: pathObject.y }
			: { x: pathObject.x2 ?? pathObject.x, y: pathObject.y2 ?? pathObject.y };

		pushPoint(points, routeStart);
		pushPoint(points, routeEnd);
		cursor = routeEnd;
	}

	if (targetObject) {
		const lastPoint = points.at(-1);
		const targetPoint = { x: targetObject.x, y: targetObject.y };
		if (lastPoint && distance(lastPoint, targetPoint) < 60) pushPoint(points, targetPoint);
	}
	return points;
}

function pointAlongRoute(points: Point[], progress: number): Point {
	if (points.length <= 1) return points[0] ?? { x: 0, y: 0 };
	const segments = points.slice(0, -1).map((point, index) => ({
		from: point,
		to: points[index + 1],
		length: distance(point, points[index + 1])
	}));
	const totalLength = segments.reduce((total, segment) => total + segment.length, 0);
	if (totalLength <= 0) return points.at(-1) ?? points[0];

	let remaining = totalLength * Math.min(1, Math.max(0, progress));
	for (const segment of segments) {
		if (remaining <= segment.length) {
			const localProgress = segment.length === 0 ? 0 : remaining / segment.length;
			return {
				x: segment.from.x + (segment.to.x - segment.from.x) * localProgress,
				y: segment.from.y + (segment.to.y - segment.from.y) * localProgress
			};
		}
		remaining -= segment.length;
	}

	return points.at(-1) ?? points[0];
}

function routeTotalLength(points: Point[]): number {
	return points
		.slice(0, -1)
		.reduce((total, point, index) => total + distance(point, points[index + 1]), 0);
}

function distanceToSegment(point: Point, from: Point, to: Point): number {
	const segmentLengthSquared = (to.x - from.x) ** 2 + (to.y - from.y) ** 2;
	if (segmentLengthSquared <= 0) return distance(point, from);
	const projection = Math.max(
		0,
		Math.min(
			1,
			((point.x - from.x) * (to.x - from.x) + (point.y - from.y) * (to.y - from.y)) /
				segmentLengthSquared
		)
	);
	return distance(point, {
		x: from.x + (to.x - from.x) * projection,
		y: from.y + (to.y - from.y) * projection
	});
}

function distanceToRoute(point: Point, points: Point[]): number {
	if (points.length <= 1) return Number.POSITIVE_INFINITY;
	return points
		.slice(0, -1)
		.reduce(
			(minimum, from, index) =>
				Math.min(minimum, distanceToSegment(point, from, points[index + 1])),
			Number.POSITIVE_INFINITY
		);
}

function routeProgressForPoint(
	point: Point,
	points: Point[]
): { progress: number; distancePx: number } {
	if (points.length <= 1) return { progress: 0, distancePx: Number.POSITIVE_INFINITY };
	const totalLength = routeTotalLength(points);
	if (totalLength <= 0) return { progress: 0, distancePx: Number.POSITIVE_INFINITY };
	let traveled = 0;
	let bestDistance = Number.POSITIVE_INFINITY;
	let bestDistanceAlongRoute = 0;

	for (const [index, from] of points.slice(0, -1).entries()) {
		const to = points[index + 1];
		const segmentLengthSquared = (to.x - from.x) ** 2 + (to.y - from.y) ** 2;
		const segmentLength = Math.sqrt(segmentLengthSquared);
		if (segmentLengthSquared <= 0) continue;
		const projection = Math.max(
			0,
			Math.min(
				1,
				((point.x - from.x) * (to.x - from.x) + (point.y - from.y) * (to.y - from.y)) /
					segmentLengthSquared
			)
		);
		const projectedPoint = {
			x: from.x + (to.x - from.x) * projection,
			y: from.y + (to.y - from.y) * projection
		};
		const projectedDistance = distance(point, projectedPoint);
		if (projectedDistance < bestDistance) {
			bestDistance = projectedDistance;
			bestDistanceAlongRoute = traveled + segmentLength * projection;
		}
		traveled += segmentLength;
	}

	return {
		progress: Math.max(0, Math.min(1, bestDistanceAlongRoute / totalLength)),
		distancePx: bestDistance
	};
}

function distanceToPathObjects(point: Point, map: StudyMap): number {
	const pathObjects = map.objects.filter((object) => object.type === 'path');
	if (pathObjects.length === 0) return Number.POSITIVE_INFINITY;
	return pathObjects.reduce(
		(minimum, pathObject) =>
			Math.min(
				minimum,
				distanceToSegment(
					point,
					{ x: pathObject.x, y: pathObject.y },
					{
						x: pathObject.x2 ?? pathObject.x,
						y: pathObject.y2 ?? pathObject.y
					}
				)
			),
		Number.POSITIVE_INFINITY
	);
}

function zoneRouteProgressBounds(
	points: Point[],
	zone: StudyMapObject | undefined
): { firstInsideProgress: number; lastInsideProgress: number } | null {
	if (!zone || points.length <= 1) return null;
	const totalLength = routeTotalLength(points);
	if (totalLength <= 0) return null;

	let traveled = 0;
	let firstInsideDistance: number | null = null;
	let lastInsideDistance: number | null = null;

	for (const [index, from] of points.slice(0, -1).entries()) {
		const to = points[index + 1];
		const segmentLength = distance(from, to);
		const steps = Math.max(1, Math.ceil(segmentLength));

		for (let step = 0; step <= steps; step += 1) {
			const localDistance = Math.min(segmentLength, step);
			const localProgress = segmentLength === 0 ? 0 : localDistance / segmentLength;
			const point = {
				x: from.x + (to.x - from.x) * localProgress,
				y: from.y + (to.y - from.y) * localProgress
			};
			if (containsPoint(zone, point)) {
				const distanceOnRoute = traveled + localDistance;
				firstInsideDistance ??= distanceOnRoute;
				lastInsideDistance = distanceOnRoute;
			}
		}

		traveled += segmentLength;
	}

	if (firstInsideDistance === null || lastInsideDistance === null) return null;
	return {
		firstInsideProgress: firstInsideDistance / totalLength,
		lastInsideProgress: lastInsideDistance / totalLength
	};
}

function progressAfterZoneExit(
	points: Point[],
	zone: StudyMapObject | undefined,
	distanceAfterExit: number
): number {
	const bounds = zoneRouteProgressBounds(points, zone);
	if (!bounds) return shuttleProgressLimit;
	const totalLength = routeTotalLength(points);
	if (totalLength <= 0) return shuttleProgressLimit;
	return Math.min(
		shuttleProgressLimit,
		bounds.lastInsideProgress + distanceAfterExit / totalLength
	);
}

function shuttleArrivingZone(map: StudyMap): StudyMapObject | undefined {
	return map.objects.find((object) => {
		if (object.type !== 'zone') return false;
		const tags = inferredZoneTriggerTags(object);
		return tags.includes('shuttle_arriving_zone_enter');
	});
}

function shuttleStopProgressForRoute(map: StudyMap, routePoints: Point[]): number {
	return progressAfterZoneExit(
		routePoints,
		shuttleArrivingZone(map),
		shuttleStopAfterArrivingZoneExitPx
	);
}

function participantPointFor(map: StudyMap, session: StudySession): Point {
	if (
		typeof session.locationOverride?.participantX === 'number' &&
		typeof session.locationOverride?.participantY === 'number'
	) {
		return {
			x: session.locationOverride.participantX,
			y: session.locationOverride.participantY
		};
	}
	const currentObject = map.objects.find((object) => object.type === 'current_location');
	const startObject =
		map.objects.find((object) => object.type === 'participant_start') ?? currentObject;
	if (!startObject) return { x: 0, y: 0 };
	const progress = Math.min(1, Math.max(0, session.locationOverride?.participantProgress ?? 0));
	return pointAlongRoute(
		routePointsFor(map, 'path', startObject, selectedPickupObject(map, session)),
		progress
	);
}

function initialParticipantLocationForMap(map: StudyMap): LocationOverride {
	const currentObject = map.objects.find((object) => object.type === 'current_location');
	if (!currentObject) return { participantProgress: 0 };
	return {
		participantProgress: 0,
		participantX: currentObject.x,
		participantY: currentObject.y,
		participantDirectionDegrees: 90,
		participantControlLevel: 0,
		participantSpeed: 5
	};
}

function currentLocationProcessPayload(
	session: StudySession,
	map: StudyMap
): Record<string, unknown> {
	const participantPoint = participantPointFor(map, session);
	const currentObject = map.objects.find((object) => object.type === 'current_location');
	const startObject =
		map.objects.find((object) => object.type === 'participant_start') ?? currentObject;
	const selectedPickup = selectedPickupObject(map, session);
	const routePoints = startObject ? routePointsFor(map, 'path', startObject, selectedPickup) : [];
	const routeProcess = routeProgressForPoint(participantPoint, routePoints);
	const selectedBlock = session.blocks.find((block) => block.block === session.activeBlock);
	return {
		participantX: Number(participantPoint.x.toFixed(1)),
		participantY: Number(participantPoint.y.toFixed(1)),
		participantDirectionDegrees: session.locationOverride?.participantDirectionDegrees,
		participantControlLevel: session.locationOverride?.participantControlLevel,
		participantSpeed: session.locationOverride?.participantSpeed,
		routeProgress: Number(routeProcess.progress.toFixed(4)),
		routeProgressPercent: Math.round(routeProcess.progress * 100),
		nearestRouteDistancePx: Number(routeProcess.distancePx.toFixed(1)),
		selectedRideOptionId: selectedBlock?.selectedRideOptionId,
		pickupPoint: selectedPickup?.label,
		activeTriggerTags: session.activeTriggerTags ?? []
	};
}

function shuttleProgressFor(map: StudyMap, session: StudySession, routePoints: Point[]): number {
	if (session.phase === 'booking') return 0;
	const arrivalSeconds = Math.max(1, session.scenario.timings.arrival);
	const stopProgress = shuttleStopProgressForRoute(map, routePoints);
	const timingProgress = Math.min(
		1,
		Math.max(0, elapsedSeconds(session.automation) / arrivalSeconds)
	);
	return Math.min(stopProgress, timingProgress * stopProgress);
}

function shuttlePointFor(map: StudyMap, session: StudySession): Point {
	const shuttleObject = map.objects.find((object) => object.type === 'shuttle');
	if (!shuttleObject) return { x: 0, y: 0 };
	const routePoints = routePointsFor(
		map,
		'shuttle_path',
		shuttleObject,
		selectedPickupObject(map, session)
	);
	return pointAlongRoute(routePoints, shuttleProgressFor(map, session, routePoints));
}

function containsPoint(zone: StudyMapObject, point: Point): boolean {
	return containsPointWithBuffer(zone, point, 0);
}

function containsPointWithBuffer(zone: StudyMapObject, point: Point, buffer: number): boolean {
	const width = zone.width ?? 80;
	const height = zone.height ?? 48;
	return (
		point.x >= zone.x - buffer &&
		point.x <= zone.x + width + buffer &&
		point.y >= zone.y - buffer &&
		point.y <= zone.y + height + buffer
	);
}

function normalizedZoneLabel(zone: StudyMapObject): string {
	return zone.label
		.trim()
		.toLowerCase()
		.replace(/[\s_]+/g, '-');
}

function inferredZoneTriggerTags(zone: StudyMapObject): MapTriggerTag[] {
	if (zone.triggerTags?.length) return zone.triggerTags;
	if (zone.type !== 'zone') return [];

	const label = normalizedZoneLabel(zone);
	if (label.includes('path-area-1')) return ['participant_route_start', 'path_area_1_enter'];
	if (label.includes('path-area-2')) return ['path_area_2_enter'];
	if (label.includes('path-area-3')) return ['participant_midroute_enter', 'path_area_3_enter'];
	if (label.includes('path-area-4')) return ['path_area_4_enter'];
	if (label.includes('waiting-area') || label.includes('waiting-zone')) {
		return ['participant_waiting_zone_enter', 'participant_waiting_zone_exit'];
	}
	if (
		label.includes('boarding-area') ||
		label.includes('boarding-zone') ||
		label.includes('pickup-area') ||
		label.includes('pickup-zone')
	) {
		return ['pickup_zone_enter', 'pickup_zone_exit', 'boarding_zone_enter', 'boarding_zone_exit'];
	}
	if (label.includes('shuttle-arriving') || label.includes('shuttle-approach')) {
		return ['shuttle_arriving_zone_enter', 'shuttle_arriving_zone_exit'];
	}

	return [];
}

function isShuttleTrigger(tag: MapTriggerTag): boolean {
	return tag.startsWith('shuttle_');
}

function automaticTriggerState(
	session: StudySession,
	map: StudyMap
): { activeTriggerTags: MapTriggerTag[]; triggerZoneState: Record<string, boolean> } {
	if (
		session.status === 'completed' ||
		session.status === 'study_finished' ||
		session.status === 'cancelled'
	) {
		return { activeTriggerTags: [], triggerZoneState: {} };
	}

	const active = new Set<MapTriggerTag>();
	const nextZoneState: Record<string, boolean> = {};
	const participantPoint = participantPointFor(map, session);
	if (distanceToPathObjects(participantPoint, map) > wrongWayRouteBufferPx) {
		active.add('participant_wrong_way');
	}
	const shuttleObject = map.objects.find((object) => object.type === 'shuttle');
	const shuttleRoutePoints = shuttleObject
		? routePointsFor(map, 'shuttle_path', shuttleObject, selectedPickupObject(map, session))
		: [];
	const shuttleProgress = shuttleObject ? shuttleProgressFor(map, session, shuttleRoutePoints) : 0;
	const shuttlePoint = shuttleObject
		? pointAlongRoute(shuttleRoutePoints, shuttleProgress)
		: { x: 0, y: 0 };

	for (const zone of map.objects.filter((object) => object.type === 'zone')) {
		const triggerTags = inferredZoneTriggerTags(zone);
		if (triggerTags.length === 0) continue;

		const usesShuttlePoint = triggerTags.some(isShuttleTrigger);
		const point = usesShuttlePoint ? shuttlePoint : participantPoint;
		const shuttleArrivingBuffer =
			usesShuttlePoint && triggerTags.includes('shuttle_arriving_zone_enter')
				? shuttleArrivingZoneBuffer
				: 0;
		const inside = containsPointWithBuffer(zone, point, shuttleArrivingBuffer);
		const shuttleBounds = usesShuttlePoint
			? zoneRouteProgressBounds(shuttleRoutePoints, zone)
			: null;
		const shuttleReachedZone = Boolean(
			shuttleBounds && shuttleProgress >= shuttleBounds.firstInsideProgress
		);
		const shuttleExitedZone = Boolean(
			shuttleBounds && shuttleProgress > shuttleBounds.lastInsideProgress
		);
		const wasInside = Boolean(session.triggerZoneState?.[zone.id]);
		const visitedKey = `${zone.id}:visited`;
		const hasVisited =
			wasInside || Boolean(session.triggerZoneState?.[visitedKey]) || shuttleReachedZone;
		nextZoneState[zone.id] = inside;
		nextZoneState[visitedKey] = hasVisited || inside || shuttleReachedZone;

		for (const tag of triggerTags) {
			if (tag.endsWith('_enter')) {
				if (inside || (usesShuttlePoint && shuttleReachedZone && !shuttleExitedZone)) {
					active.add(tag);
				}
			} else if (tag.endsWith('_exit')) {
				if (
					(!usesShuttlePoint && wasInside && !inside) ||
					(usesShuttlePoint && shuttleExitedZone)
				) {
					active.add(tag);
				}
			} else if (inside) {
				active.add(tag);
			}
		}
	}

	if (session.phase === 'delay') active.add('delay_notice_shown');
	if (session.phase === 'near_arrival' && session.scenario.includeDelay) {
		active.add('revised_eta_acknowledged');
	}

	return { activeTriggerTags: [...active], triggerZoneState: nextZoneState };
}

function sameStringSet(left: string[] = [], right: string[] = []): boolean {
	if (left.length !== right.length) return false;
	const leftSet = new Set(left);
	return right.every((item) => leftSet.has(item));
}

function sameZoneState(
	left: Record<string, boolean> = {},
	right: Record<string, boolean> = {}
): boolean {
	const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
	for (const key of keys) {
		if (Boolean(left[key]) !== Boolean(right[key])) return false;
	}
	return true;
}

async function applyAutomaticTriggers(session: StudySession): Promise<StudySession> {
	if (!['ready', 'running', 'paused'].includes(session.status)) return session;
	const map = await readJson<StudyMap>(mapPath(session.selectedMapId));
	if (!map) return session;
	const nextTriggerState = automaticTriggerState(session, map);
	if (
		sameStringSet(session.activeTriggerTags, nextTriggerState.activeTriggerTags) &&
		sameZoneState(session.triggerZoneState, nextTriggerState.triggerZoneState)
	) {
		return session;
	}

	const next = {
		...session,
		activeTriggerTags: nextTriggerState.activeTriggerTags,
		triggerZoneState: nextTriggerState.triggerZoneState
	};
	if (!sameStringSet(session.activeTriggerTags, nextTriggerState.activeTriggerTags)) {
		return pushEvent(
			next,
			makeEvent(next, 'automatic_triggers_updated', 'system', {
				activeTriggerTags: nextTriggerState.activeTriggerTags
			})
		);
	}
	return { ...next, updatedAt: nowIso() };
}

function phaseForElapsed(session: StudySession): StudyPhase {
	const elapsed = elapsedSeconds(session.automation);
	const { includeDelay, timings } = session.scenario;
	const activeBlock = session.blocks.find((block) => block.block === session.activeBlock);
	if (session.phase === 'assignment' && activeBlock?.assignedAt) {
		const assignedAt = new Date(activeBlock.assignedAt).getTime();
		const assignedAgeSeconds = Math.max(0, Math.floor((Date.now() - assignedAt) / 1000));
		if (assignedAgeSeconds < assignmentVehicleFocusBufferSeconds) return 'assignment';
	}
	if (elapsed >= timings.near_arrival) return 'near_arrival';
	if (includeDelay && elapsed >= timings.delay) return 'delay';
	if (elapsed >= session.scenario.assignmentDurationSeconds) return 'waiting';
	return 'assignment';
}

function sicBoardingStartElapsed(session: StudySession): number {
	return session.scenario.timings.near_arrival + session.scenario.arrivalCompletionBufferSeconds;
}

function elapsedForPhase(session: StudySession, phase: StudyPhase): number {
	if (phase === 'arrival') return sicBoardingStartElapsed(session);
	if (phase === 'near_arrival') return session.scenario.timings.near_arrival;
	if (phase === 'delay') return session.scenario.timings.delay;
	if (phase === 'waiting') return session.scenario.assignmentDurationSeconds;
	return 0;
}

function pushEvent(session: StudySession, event: StudyEvent): StudySession {
	const blocks = session.blocks.map((block) =>
		block.block === session.activeBlock ? { ...block, events: [...block.events, event] } : block
	);
	return {
		...session,
		updatedAt: nowIso(),
		events: [...session.events, event],
		blocks
	};
}

function normalizeScenario(scenario: Partial<ScenarioConfig> | null | undefined): ScenarioConfig {
	return {
		...defaultScenario,
		...scenario,
		timings: {
			...defaultScenario.timings,
			...scenario?.timings
		},
		phaseCopy: {
			...normalizeScenarioCopy(scenario?.phaseCopy ?? {}, defaultScenario.phaseCopy)
		},
		microUpdates: {
			...normalizeScenarioCopy(scenario?.microUpdates ?? {}, defaultScenario.microUpdates)
		},
		supportMock: normalizeScenarioCopy(scenario?.supportMock ?? {}, defaultScenario.supportMock),
		vehicleIdentifiers:
			Array.isArray(scenario?.vehicleIdentifiers) && scenario.vehicleIdentifiers.length > 0
				? scenario.vehicleIdentifiers
				: defaultScenario.vehicleIdentifiers,
		rideOptions:
			Array.isArray(scenario?.rideOptions) && scenario.rideOptions.length > 0
				? scenario.rideOptions.map(normalizeRideOptionCopy)
				: defaultRideOptions
	};
}

function normalizeBlock(block: BlockState): BlockState {
	return {
		...block,
		rideRequestStatus: block.rideRequestStatus ?? 'none'
	};
}

function buildScenario(
	baseScenario: ScenarioConfig,
	inputScenario?: Partial<ScenarioConfig> & { timings?: Partial<ScenarioConfig['timings']> }
): ScenarioConfig {
	return normalizeScenario({
		...baseScenario,
		...inputScenario,
		timings: {
			...baseScenario.timings,
			...inputScenario?.timings
		},
		rideOptions: inputScenario?.rideOptions ?? baseScenario.rideOptions
	});
}

function normalizeSession(session: StudySession | null): StudySession | null {
	if (!session) return null;
	return {
		...session,
		sicBoardingStep: sicBoardingStepValues.has(session.sicBoardingStep as SicBoardingStep)
			? (session.sicBoardingStep as SicBoardingStep)
			: undefined,
		scenario: normalizeScenario(session.scenario),
		blocks: session.blocks.map(normalizeBlock)
	};
}

function withSicBoardingState(session: StudySession): StudySession {
	if (
		session.phase === 'arrival' &&
		(session.status === 'running' || session.status === 'completed')
	) {
		return session;
	}
	return session.sicBoardingStep ? { ...session, sicBoardingStep: undefined } : session;
}

async function persistSessionAndParticipant(session: StudySession): Promise<StudySession> {
	const updated = { ...session, updatedAt: nowIso() };
	await writeJson(sessionFile, updated);
	const participant: ParticipantRecord = {
		participantId: updated.participantId,
		sessionId: updated.sessionId,
		conditionOrder: updated.conditionOrder,
		selectedMapId: updated.selectedMapId,
		scenario: updated.scenario,
		registrationStatus: updated.blocks.every((block) => Boolean(block.completedAt))
			? 'completed'
			: 'started',
		locationOverride: updated.locationOverride,
		activeTriggerTags: updated.activeTriggerTags ?? [],
		triggerZoneState: updated.triggerZoneState ?? {},
		sicBoardingStep: updated.sicBoardingStep,
		notes: updated.notes,
		technicalIssues: updated.technicalIssues,
		createdAt: updated.createdAt,
		updatedAt: updated.updatedAt,
		blocks: updated.blocks,
		events: updated.events
	};
	await writeJson(participantPath(updated.participantId), participant);
	return updated;
}

async function applyAutomation(session: StudySession | null): Promise<StudySession | null> {
	if (!session || session.status !== 'running') return session;
	const elapsed = elapsedSeconds(session.automation);
	let runningSession = session;
	if (
		runningSession.phase === 'assignment' &&
		elapsed >= runningSession.scenario.assignmentDurationSeconds &&
		runningSession.blocks.find((block) => block.block === runningSession.activeBlock)
			?.rideRequestStatus === 'requested'
	) {
		const assigned = {
			...runningSession,
			blocks: runningSession.blocks.map((block) =>
				block.block === runningSession.activeBlock
					? {
							...block,
							rideRequestStatus: 'assigned' as const,
							assignedAt: block.assignedAt ?? nowIso()
						}
					: block
			)
		};
		runningSession = pushEvent(
			assigned,
			makeEvent(assigned, 'automation_vehicle_assigned', 'automation')
		);
	}
	if (
		runningSession.phase === 'near_arrival' &&
		elapsed >=
			runningSession.scenario.timings.near_arrival +
				runningSession.scenario.arrivalCompletionBufferSeconds
	) {
		const completed = {
			...runningSession,
			status: 'completed' as const,
			automation: {
				startedAt: undefined,
				pausedAt: undefined,
				elapsedBeforePauseSeconds: elapsed
			},
			blocks: runningSession.blocks.map((block) =>
				block.block === runningSession.activeBlock
					? { ...block, completedAt: block.completedAt ?? nowIso() }
					: block
			)
		};
		return persistSessionAndParticipant(
			pushEvent(
				completed,
				makeEvent(completed, 'automation_block_completed_after_near_arrival_buffer', 'automation')
			)
		);
	}
	const nextPhase = phaseForElapsed(runningSession);
	if (nextPhase === runningSession.phase) return runningSession;

	let next = withSicBoardingState({ ...runningSession, phase: nextPhase });
	next = pushEvent(
		next,
		makeEvent(
			next,
			`automation_phase_${nextPhase}`,
			'automation',
			next.sicBoardingStep ? { sicBoardingStep: next.sicBoardingStep } : undefined
		)
	);
	return persistSessionAndParticipant(next);
}

export async function listMaps(): Promise<StudyMap[]> {
	await ensureData();
	const files = (await readdir(mapsDir)).filter((file) => file.endsWith('.json'));
	const maps = await Promise.all(
		files.map(async (file) => {
			const map = await readJson<StudyMap>(path.join(mapsDir, file));
			if (!map) return null;
			return { ...map, id: path.basename(file, '.json') };
		})
	);
	return maps
		.filter((map): map is StudyMap => Boolean(map))
		.map(normalizeMap)
		.sort((a, b) => a.name.localeCompare(b.name));
}

export async function listParticipantSummaries(): Promise<ParticipantSummary[]> {
	await ensureData();
	const files = (await readdir(participantsDir)).filter((file) => file.endsWith('.json'));
	const records = await Promise.all(
		files.map(async (file) => readJson<ParticipantRecord>(path.join(participantsDir, file)))
	);
	return records
		.filter((record): record is ParticipantRecord => Boolean(record))
		.map((record) => {
			const completedBlocks = record.blocks.filter((block) => Boolean(block.completedAt)).length;
			const status: ParticipantSummary['status'] =
				record.registrationStatus === 'registered' || !record.sessionId
					? 'registered'
					: completedBlocks >= record.blocks.length
						? 'completed'
						: 'in_progress';
			return {
				participantId: record.participantId,
				sessionId: record.sessionId,
				conditionOrder: record.conditionOrder,
				selectedMapId: record.selectedMapId,
				scenario: record.scenario,
				createdAt: record.createdAt,
				updatedAt: record.updatedAt,
				completedBlocks,
				totalBlocks: record.blocks.length,
				status
			};
		})
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getParticipant(participantId: string): Promise<ParticipantRecord> {
	await ensureData();
	const current = await readJson<ParticipantRecord>(participantPath(participantId.trim()));
	if (!current) throw new Error(`Participant ID "${participantId}" was not found.`);
	return current;
}

async function getLockedStudyScenario(): Promise<ScenarioConfig | null> {
	const activeSession = await readJson<StudySession>(sessionFile);
	if (activeSession?.scenario) return normalizeScenario(activeSession.scenario);
	const files = (await readdir(participantsDir)).filter((file) => file.endsWith('.json'));
	const records = (
		await Promise.all(
			files.map(async (file) => readJson<ParticipantRecord>(path.join(participantsDir, file)))
		)
	)
		.filter((record): record is ParticipantRecord => Boolean(record))
		.filter((record) => record.registrationStatus !== 'registered' && Boolean(record.scenario))
		.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	return records[0]?.scenario ? normalizeScenario(records[0].scenario) : null;
}

export async function createParticipant(input: {
	participantId: string;
	conditionOrder: ConditionOrder;
	selectedMapId: string;
	scenario?: Partial<ScenarioConfig> & { timings?: Partial<ScenarioConfig['timings']> };
}): Promise<ParticipantRecord> {
	await ensureData();
	const participantId = input.participantId.trim();
	if (!participantId) throw new Error('participantId is required');
	const selectedMapId = input.selectedMapId?.trim() || defaultParticipantMapId;
	if (await readJson<ParticipantRecord>(participantPath(participantId))) {
		throw new Error(
			`Participant ID "${participantId}" already exists. Use the next assigned participant ID.`
		);
	}
	const baseScenario = await loadDefaultScenario();
	const scenario = (await getLockedStudyScenario()) ?? buildScenario(baseScenario, input.scenario);
	const [first, second] = conditionPair(input.conditionOrder);
	const timestamp = nowIso();
	const participant: ParticipantRecord = {
		participantId,
		conditionOrder: input.conditionOrder,
		selectedMapId,
		scenario,
		registrationStatus: 'registered',
		notes: '',
		technicalIssues: [],
		createdAt: timestamp,
		updatedAt: timestamp,
		blocks: [
			{ block: 1, condition: first, rideRequestStatus: 'none', events: [] },
			{ block: 2, condition: second, rideRequestStatus: 'none', events: [] }
		],
		events: []
	};
	await writeJson(participantPath(participantId), participant);
	return participant;
}

export async function updateRegisteredParticipant(
	currentParticipantId: string,
	input: {
		participantId: string;
		conditionOrder: ConditionOrder;
		selectedMapId: string;
		scenario?: Partial<ScenarioConfig> & { timings?: Partial<ScenarioConfig['timings']> };
	}
): Promise<ParticipantRecord> {
	await ensureData();
	const currentId = currentParticipantId.trim();
	const nextId = input.participantId.trim();
	if (!currentId) throw new Error('participantId is required');
	if (!nextId) throw new Error('participantId is required');
	const selectedMapId = input.selectedMapId?.trim() || defaultParticipantMapId;
	const current = await readJson<ParticipantRecord>(participantPath(currentId));
	if (!current) throw new Error(`Participant ID "${currentId}" was not found.`);
	if (current.registrationStatus !== 'registered' || current.sessionId) {
		throw new Error('Only registered, not-started participant records can be edited.');
	}
	if (
		safeFilename(currentId) !== safeFilename(nextId) &&
		(await readJson<ParticipantRecord>(participantPath(nextId)))
	) {
		throw new Error(
			`Participant ID "${nextId}" already exists. Use the next assigned participant ID.`
		);
	}
	const scenario =
		(await getLockedStudyScenario()) ??
		buildScenario(current.scenario ?? (await loadDefaultScenario()), input.scenario);
	const [first, second] = conditionPair(input.conditionOrder);
	const updated: ParticipantRecord = {
		...current,
		participantId: nextId,
		conditionOrder: input.conditionOrder,
		selectedMapId,
		scenario,
		registrationStatus: 'registered',
		updatedAt: nowIso(),
		blocks: [
			{ block: 1, condition: first, rideRequestStatus: 'none', events: [] },
			{ block: 2, condition: second, rideRequestStatus: 'none', events: [] }
		],
		events: []
	};
	await writeJson(participantPath(nextId), updated);
	if (safeFilename(currentId) !== safeFilename(nextId)) await unlink(participantPath(currentId));
	return updated;
}

export async function deleteRegisteredParticipant(participantId: string): Promise<void> {
	await ensureData();
	const current = await readJson<ParticipantRecord>(participantPath(participantId));
	if (!current) throw new Error(`Participant ID "${participantId}" was not found.`);
	if (current.registrationStatus !== 'registered' || current.sessionId) {
		throw new Error('Only registered, not-started participant records can be removed.');
	}
	await unlink(participantPath(participantId));
}

export async function getMap(id: string): Promise<StudyMap | null> {
	await ensureData();
	const map = await readJson<StudyMap>(mapPath(id));
	return map ? normalizeMap(map) : null;
}

export async function saveMap(map: StudyMap): Promise<StudyMap> {
	await ensureData();
	const timestamp = nowIso();
	const next: StudyMap = normalizeMap({
		...map,
		id: safeFilename(map.id || map.name.toLowerCase()),
		updatedAt: timestamp,
		createdAt: map.createdAt || timestamp
	});
	await writeJson(mapPath(next.id), next);
	return next;
}

export async function deleteMap(id: string): Promise<void> {
	await ensureData();
	const maps = await listMaps();
	if (maps.length <= 1) throw new Error('At least one study map must remain');
	const session = await readJson<StudySession>(sessionFile);
	if (session?.mapLocked && session.selectedMapId === id) {
		throw new Error('The active session map is locked and cannot be deleted');
	}
	await unlink(mapPath(id));
}

async function getSessionInternal(): Promise<StudySession | null> {
	await ensureData();
	const session = normalizeSession(await readJson<StudySession>(sessionFile));
	const automated = await applyAutomation(session);
	if (!automated) return automated;
	const withTriggers = await applyAutomaticTriggers(automated);
	if (
		!sameStringSet(automated.activeTriggerTags, withTriggers.activeTriggerTags) ||
		!sameZoneState(automated.triggerZoneState, withTriggers.triggerZoneState)
	) {
		const persisted = await persistSessionAndParticipant(withTriggers);
		syncLiveStateForSession(persisted);
		return persisted;
	}
	syncLiveStateForSession(withTriggers);
	return withTriggers;
}

export async function getSession(): Promise<StudySession | null> {
	return withSessionMutation(() => getSessionInternal());
}

export async function getState(): Promise<StateResponse> {
	const [session, maps, participants] = await Promise.all([
		getSession(),
		listMaps(),
		listParticipantSummaries()
	]);
	const map = session
		? ((await getMap(session.selectedMapId)) ?? maps[0] ?? null)
		: (maps[0] ?? null);
	return {
		session,
		map,
		maps,
		participants,
		live:
			session && liveState?.sessionId === session.sessionId && session.status !== 'study_finished'
				? liveState
				: null,
		now: nowIso()
	};
}

export async function updateLiveState(input: {
	locationOverride?: LocationOverride;
	activeTriggerTags?: MapTriggerTag[];
	scroll?: {
		scrollY?: number;
		scrollHeight?: number;
		clientHeight?: number;
		scrollPercent?: number;
	};
}): Promise<SessionLiveState | null> {
	const current =
		liveState && (input.locationOverride || input.activeTriggerTags)
			? ({
					sessionId: liveState.sessionId,
					participantId: liveState.participantId,
					activeBlock: liveState.block,
					activeCondition: liveState.condition,
					phase: liveState.phase,
					status: 'running',
					locationOverride: liveState.locationOverride
				} as StudySession)
			: await getSession();
	if (
		!current ||
		current.status === 'completed' ||
		current.status === 'study_finished' ||
		current.status === 'cancelled'
	) {
		return null;
	}
	const maxScroll = input.scroll
		? Math.max(0, Number(input.scroll.scrollHeight ?? 0) - Number(input.scroll.clientHeight ?? 0))
		: 0;
	const scrollY = input.scroll
		? Math.max(
				0,
				Math.min(Number(input.scroll.scrollY ?? 0), maxScroll || Number(input.scroll.scrollY ?? 0))
			)
		: 0;
	const scrollPercent = input.scroll
		? typeof input.scroll.scrollPercent === 'number'
			? Math.max(0, Math.min(1, input.scroll.scrollPercent))
			: maxScroll > 0
				? scrollY / maxScroll
				: 0
		: 0;
	liveState = {
		sessionId: current.sessionId,
		participantId: current.participantId,
		block: current.activeBlock,
		condition: current.activeCondition,
		phase: current.phase,
		updatedAt: nowIso(),
		locationOverride: input.locationOverride
			? {
					...current.locationOverride,
					...liveState?.locationOverride,
					...input.locationOverride,
					updatedAt: nowIso()
				}
			: liveState?.locationOverride,
		activeTriggerTags: input.activeTriggerTags ?? liveState?.activeTriggerTags,
		scroll: input.scroll
			? {
					scrollY: Math.round(scrollY),
					scrollHeight: Math.max(0, Math.round(Number(input.scroll.scrollHeight ?? 0))),
					clientHeight: Math.max(0, Math.round(Number(input.scroll.clientHeight ?? 0))),
					scrollPercent
				}
			: liveState?.scroll
	};
	publishLiveState(liveState);
	return liveState;
}

export async function getLiveState(): Promise<SessionLiveState | null> {
	return liveState;
}

function publishLiveState(state: SessionLiveState | null) {
	if (!state) return;
	for (const subscriber of liveStateSubscribers) subscriber(state);
}

export function subscribeLiveState(listener: (state: SessionLiveState) => void): () => void {
	liveStateSubscribers.add(listener);
	if (liveState) listener(liveState);
	return () => {
		liveStateSubscribers.delete(listener);
	};
}

function resetLiveStateForSession(session: StudySession, map: StudyMap | null) {
	liveState = {
		sessionId: session.sessionId,
		participantId: session.participantId,
		block: session.activeBlock,
		condition: session.activeCondition,
		phase: session.phase,
		updatedAt: nowIso(),
		locationOverride: map
			? {
					...initialParticipantLocationForMap(map),
					updatedAt: nowIso()
				}
			: session.locationOverride,
		activeTriggerTags: session.activeTriggerTags ?? [],
		scroll: liveState?.sessionId === session.sessionId ? liveState.scroll : undefined
	};
	publishLiveState(liveState);
}

function syncLiveStateForSession(session: StudySession) {
	if (!liveState || liveState.sessionId !== session.sessionId) return;
	const nextLiveState: SessionLiveState = {
		...liveState,
		participantId: session.participantId,
		block: session.activeBlock,
		condition: session.activeCondition,
		phase: session.phase,
		updatedAt: nowIso(),
		locationOverride: liveState.locationOverride ?? session.locationOverride,
		activeTriggerTags: session.activeTriggerTags ?? []
	};
	if (
		nextLiveState.block === liveState.block &&
		nextLiveState.condition === liveState.condition &&
		nextLiveState.phase === liveState.phase &&
		sameStringSet(nextLiveState.activeTriggerTags, liveState.activeTriggerTags)
	) {
		return;
	}
	liveState = nextLiveState;
	publishLiveState(liveState);
}

export async function startSession(input: {
	participantId: string;
	conditionOrder: ConditionOrder;
	selectedMapId: string;
	scenario?: Partial<ScenarioConfig> & { timings?: Partial<ScenarioConfig['timings']> };
}): Promise<StudySession> {
	return withSessionMutation(async () => {
		await ensureData();
		const activeSession = await readJson<StudySession>(sessionFile);
		if (
			activeSession &&
			activeSession.status !== 'cancelled' &&
			activeSession.status !== 'study_finished' &&
			!activeSession.blocks.every((block) => Boolean(block.completedAt))
		) {
			throw new Error(
				'Finish or cancel the active session before starting a new participant session'
			);
		}
		const participantId = input.participantId.trim();
		if (!participantId) throw new Error('participantId is required');
		const existingParticipant = await readJson<ParticipantRecord>(participantPath(participantId));
		if (!existingParticipant) {
			throw new Error(
				`Participant ID "${participantId}" is not registered. Create the participant record first.`
			);
		}
		if (existingParticipant.registrationStatus !== 'registered') {
			throw new Error(
				`Participant ID "${participantId}" already exists. Use the next assigned participant ID.`
			);
		}
		const conditionOrder = existingParticipant.conditionOrder;
		const selectedMapId =
			input.selectedMapId?.trim() || existingParticipant?.selectedMapId || defaultParticipantMapId;
		const selectedMap = await getMap(selectedMapId);
		const [first, second] = conditionPair(conditionOrder);
		const timestamp = nowIso();
		const baseScenario = await loadDefaultScenario();
		const scenario: ScenarioConfig =
			(await getLockedStudyScenario()) ??
			buildScenario(existingParticipant?.scenario ?? baseScenario, input.scenario);
		const blocks: BlockState[] = [
			{ block: 1, condition: first, rideRequestStatus: 'none', startedAt: timestamp, events: [] },
			{ block: 2, condition: second, rideRequestStatus: 'none', events: [] }
		];
		let session: StudySession = {
			sessionId: makeId('session'),
			participantId,
			conditionOrder,
			activeBlock: 1,
			activeCondition: first,
			phase: 'booking',
			status: 'ready',
			selectedMapId,
			mapLocked: true,
			scenario,
			automation: { elapsedBeforePauseSeconds: 0 },
			locationOverride: selectedMap ? initialParticipantLocationForMap(selectedMap) : undefined,
			activeTriggerTags: [],
			triggerZoneState: {},
			notes: '',
			technicalIssues: [],
			createdAt: existingParticipant?.createdAt ?? timestamp,
			updatedAt: timestamp,
			blocks,
			events: []
		};
		session = pushEvent(
			session,
			makeEvent(session, 'study_started', 'dashboard', { screen: 'dashboard' })
		);
		session = pushEvent(
			session,
			makeEvent(session, 'session_started', 'dashboard', { screen: 'dashboard' })
		);
		session = await applyAutomaticTriggers(session);
		const persisted = await persistSessionAndParticipant(session);
		resetLiveStateForSession(persisted, selectedMap);
		return persisted;
	});
}

export async function updateSession(input: {
	phase?: StudyPhase;
	activeBlock?: 1 | 2;
	activeCondition?: Condition;
	status?: StudySession['status'];
	notes?: string;
	technicalIssue?: string;
	selectedRideOptionId?: string;
	rideRequestStatus?: RideRequestStatus;
	scenario?: Partial<ScenarioConfig> & { timings?: Partial<ScenarioConfig['timings']> };
	locationOverride?: LocationOverride;
	sicBoardingStep?: SicBoardingStep | null;
	activeTriggerTags?: MapTriggerTag[];
	eventType?: string;
	eventSource?: StudyEvent['source'];
	payload?: Record<string, unknown>;
}): Promise<StudySession> {
	return withSessionMutation(async () => {
		const current = await getSessionInternal();
		if (!current) throw new Error('No active session');
		if (current.status === 'study_finished' || current.status === 'cancelled') {
			return current;
		}
		let next = current;
		let shouldResetLiveLocation = false;
		const currentBlock = current.blocks.find((item) => item.block === current.activeBlock);
		const currentBlockCompleted = Boolean(
			currentBlock?.completedAt || current.status === 'completed'
		);

		if (input.activeBlock && input.activeBlock !== current.activeBlock) {
			if (!currentBlock?.completedAt && current.status !== 'completed') {
				throw new Error('Finish the active block before switching to the next block.');
			}
			const block = next.blocks.find((item) => item.block === input.activeBlock);
			if (block?.completedAt) {
				throw new Error('The selected block is already completed.');
			}
			if (block) {
				const selectedMap = await getMap(next.selectedMapId);
				next = {
					...next,
					activeBlock: input.activeBlock,
					activeCondition: block.condition,
					phase: 'booking',
					status: 'ready',
					automation: { elapsedBeforePauseSeconds: 0 },
					locationOverride: selectedMap ? initialParticipantLocationForMap(selectedMap) : undefined,
					sicBoardingStep: undefined,
					activeTriggerTags: [],
					triggerZoneState: {},
					blocks: next.blocks.map((item) =>
						item.block === input.activeBlock
							? {
									...item,
									startedAt: item.startedAt ?? nowIso(),
									rideRequestStatus: item.rideRequestStatus ?? 'none'
								}
							: item
					)
				};
				shouldResetLiveLocation = true;
			}
		}

		if (input.phase) next = { ...next, phase: input.phase };
		if (input.activeCondition) next = { ...next, activeCondition: input.activeCondition };
		if (input.status) next = { ...next, status: input.status };
		if (input.sicBoardingStep !== undefined) {
			if (input.sicBoardingStep === null) {
				next = { ...next, sicBoardingStep: undefined };
			} else {
				if (!sicBoardingStepValues.has(input.sicBoardingStep)) {
					throw new Error('Invalid SIC boarding step.');
				}
				if (next.phase !== 'arrival' || next.status === 'study_finished') {
					throw new Error('Boarding steps are only available after near-arrival.');
				}
				next = { ...next, sicBoardingStep: input.sicBoardingStep };
			}
		}
		if (input.locationOverride) {
			if (currentBlockCompleted) {
				throw new Error('Location overrides are disabled after the active block is finished.');
			}
			next = {
				...next,
				locationOverride: {
					...next.locationOverride,
					...input.locationOverride,
					updatedAt: nowIso()
				}
			};
		}
		if (input.activeTriggerTags) {
			if (currentBlockCompleted) {
				throw new Error('Trigger overrides are disabled after the active block is finished.');
			}
			next = {
				...next,
				activeTriggerTags: input.activeTriggerTags
			};
		}
		if (typeof input.notes === 'string') next = { ...next, notes: input.notes };
		if (input.technicalIssue?.trim()) {
			next = { ...next, technicalIssues: [...next.technicalIssues, input.technicalIssue.trim()] };
		}
		if (typeof input.selectedRideOptionId === 'string' || input.rideRequestStatus) {
			if (currentBlockCompleted) {
				throw new Error('Ride request changes are disabled after the active block is finished.');
			}
			const timestamp = nowIso();
			next = {
				...next,
				blocks: next.blocks.map((block) =>
					block.block === next.activeBlock
						? (() => {
								const requestedOptionId =
									typeof input.selectedRideOptionId === 'string'
										? input.selectedRideOptionId
										: block.selectedRideOptionId;
								const shouldAssignDirect =
									input.rideRequestStatus === 'requested' &&
									Boolean(requestedOptionId) &&
									requestedOptionId !== directRideOptionId;
								return {
									...block,
									selectedRideOptionId:
										input.rideRequestStatus === 'cancelled'
											? undefined
											: shouldAssignDirect
												? directRideOptionId
												: (requestedOptionId ?? block.selectedRideOptionId),
									assignmentFallbackFromOptionId:
										input.rideRequestStatus === 'cancelled' ||
										input.rideRequestStatus === 'selected'
											? undefined
											: shouldAssignDirect
												? requestedOptionId
												: block.assignmentFallbackFromOptionId,
									rideRequestStatus:
										input.rideRequestStatus === 'cancelled'
											? 'none'
											: (input.rideRequestStatus ?? block.rideRequestStatus),
									selectedAt:
										input.rideRequestStatus === 'selected' && !block.selectedAt
											? timestamp
											: block.selectedAt,
									requestedAt:
										input.rideRequestStatus === 'requested' && !block.requestedAt
											? timestamp
											: block.requestedAt,
									assignedAt:
										input.rideRequestStatus === 'assigned' && !block.assignedAt
											? timestamp
											: block.assignedAt,
									cancelledAt:
										input.rideRequestStatus === 'cancelled' ? timestamp : block.cancelledAt,
									timeToRequestSeconds:
										input.rideRequestStatus === 'requested'
											? Math.max(
													0,
													Math.round(
														(new Date(timestamp).getTime() -
															new Date(
																block.selectedAt ?? block.startedAt ?? next.createdAt
															).getTime()) /
															1000
													)
												)
											: block.timeToRequestSeconds
								};
							})()
						: block
				)
			};
			if (input.rideRequestStatus === 'requested') {
				next = {
					...next,
					status: 'running',
					phase: 'assignment',
					automation: { startedAt: timestamp, pausedAt: undefined, elapsedBeforePauseSeconds: 0 }
				};
			}
		}
		if (input.scenario) {
			if (currentBlockCompleted) {
				throw new Error('Scenario timing changes are disabled after the active block is finished.');
			}
			next = {
				...next,
				scenario: {
					...next.scenario,
					...input.scenario,
					timings: {
						...next.scenario.timings,
						...input.scenario.timings
					},
					rideOptions: input.scenario.rideOptions ?? next.scenario.rideOptions
				}
			};
		}

		next = withSicBoardingState(next);
		next = pushEvent(
			next,
			makeEvent(next, input.eventType ?? 'session_updated', input.eventSource ?? 'dashboard', {
				screen: 'dashboard',
				...input.payload
			})
		);
		next = await applyAutomaticTriggers(next);
		if (input.locationOverride) {
			const processMap = await getMap(next.selectedMapId);
			if (processMap) {
				next = pushEvent(
					next,
					makeEvent(next, 'current_location_process', 'system', {
						screen: 'dashboard',
						source: input.payload?.source ?? 'location_override',
						...currentLocationProcessPayload(next, processMap)
					})
				);
			}
		}
		const persisted = await persistSessionAndParticipant(next);
		if (shouldResetLiveLocation) {
			resetLiveStateForSession(persisted, await getMap(persisted.selectedMapId));
		} else {
			syncLiveStateForSession(persisted);
		}
		return persisted;
	});
}

export async function recordEvent(input: {
	type: string;
	source: StudyEvent['source'];
	payload?: Record<string, unknown>;
}): Promise<StudySession> {
	return withSessionMutation(async () => {
		const current = await getSessionInternal();
		if (!current) throw new Error('No active session');
		if (current.status === 'study_finished' || current.status === 'cancelled') {
			return current;
		}
		const event = makeEvent(current, input.type, input.source, input.payload);
		return persistSessionAndParticipant(pushEvent(current, event));
	});
}

export async function automationAction(
	action: 'pause' | 'resume' | 'jump' | 'finish' | 'finish_study',
	phase?: StudyPhase
): Promise<StudySession> {
	return withSessionMutation(async () => {
		const current = await getSessionInternal();
		if (!current) throw new Error('No active session');
		let next = current;
		const currentBlock = current.blocks.find((block) => block.block === current.activeBlock);
		const currentBlockCompleted = Boolean(
			currentBlock?.completedAt ||
			current.status === 'completed' ||
			current.status === 'study_finished'
		);
		const allBlocksCompleted = current.blocks.every((block) => Boolean(block.completedAt));

		if (current.status === 'study_finished') {
			throw new Error('The study session is already finished.');
		}
		if (current.status === 'cancelled') {
			throw new Error('The session is cancelled.');
		}
		if (action === 'pause' && (current.status !== 'running' || currentBlockCompleted)) {
			throw new Error('Pause is only available while an unfinished block is running.');
		}
		if (action === 'resume' && (current.status !== 'paused' || currentBlockCompleted)) {
			throw new Error('Resume is only available while an unfinished block is paused.');
		}
		if (
			action === 'jump' &&
			(currentBlockCompleted || !['ready', 'running', 'paused'].includes(current.status))
		) {
			throw new Error('Phase jumps are only available before the active block is finished.');
		}
		if (
			action === 'finish' &&
			(currentBlockCompleted || !['running', 'paused'].includes(current.status))
		) {
			throw new Error('Finish block is only available for a running or paused unfinished block.');
		}
		if (action === 'finish_study' && !allBlocksCompleted) {
			throw new Error('Finish the active block sequence before finishing the study.');
		}

		if (action === 'pause') {
			next = {
				...next,
				status: 'paused',
				automation: {
					startedAt: undefined,
					pausedAt: nowIso(),
					elapsedBeforePauseSeconds: elapsedSeconds(next.automation)
				}
			};
		} else if (action === 'resume') {
			next = {
				...next,
				status: 'running',
				automation: {
					startedAt: nowIso(),
					pausedAt: undefined,
					elapsedBeforePauseSeconds: next.automation.elapsedBeforePauseSeconds
				}
			};
		} else if (action === 'jump' && phase) {
			const jumpedElapsed = elapsedForPhase(next, phase);
			const timestamp = nowIso();
			if (phase === 'assignment') {
				const activeBlock = next.blocks.find((block) => block.block === next.activeBlock);
				const requestedRideOptionId =
					activeBlock?.selectedRideOptionId ??
					next.scenario.rideOptions.find((option) => option.isRecommended)?.id ??
					next.scenario.rideOptions[0]?.id;
				const shouldAssignDirect =
					Boolean(requestedRideOptionId) && requestedRideOptionId !== directRideOptionId;
				next = {
					...next,
					status: 'running',
					blocks: next.blocks.map((block) =>
						block.block === next.activeBlock
							? {
									...block,
									selectedRideOptionId: shouldAssignDirect
										? directRideOptionId
										: requestedRideOptionId,
									assignmentFallbackFromOptionId: shouldAssignDirect
										? requestedRideOptionId
										: block.assignmentFallbackFromOptionId,
									rideRequestStatus:
										block.rideRequestStatus === 'assigned' ? block.rideRequestStatus : 'requested',
									selectedAt: block.selectedAt ?? timestamp,
									requestedAt: block.requestedAt ?? timestamp,
									timeToRequestSeconds:
										block.timeToRequestSeconds ??
										Math.max(
											0,
											Math.round(
												(new Date(timestamp).getTime() -
													new Date(block.startedAt ?? next.createdAt).getTime()) /
													1000
											)
										)
								}
							: block
					)
				};
			}
			next = {
				...next,
				phase,
				status:
					phase === 'near_arrival' || phase === 'arrival' || phase === 'assignment'
						? 'running'
						: next.status,
				automation: {
					startedAt:
						next.status === 'running' ||
						phase === 'near_arrival' ||
						phase === 'arrival' ||
						phase === 'assignment'
							? timestamp
							: undefined,
					pausedAt: next.status === 'paused' ? nowIso() : undefined,
					elapsedBeforePauseSeconds: jumpedElapsed
				}
			};
			next = withSicBoardingState(next);
		} else if (action === 'finish') {
			next = {
				...next,
				status: 'completed',
				phase: 'near_arrival',
				sicBoardingStep: undefined,
				automation: {
					startedAt: undefined,
					pausedAt: undefined,
					elapsedBeforePauseSeconds: elapsedSeconds(next.automation)
				},
				blocks: next.blocks.map((block) =>
					block.block === next.activeBlock
						? { ...block, completedAt: block.completedAt ?? nowIso() }
						: block
				)
			};
		} else if (action === 'finish_study') {
			next = {
				...next,
				status: 'study_finished',
				phase: 'near_arrival',
				sicBoardingStep: undefined,
				automation: {
					startedAt: undefined,
					pausedAt: undefined,
					elapsedBeforePauseSeconds: elapsedSeconds(next.automation)
				},
				blocks: next.blocks.map((block) => ({
					...block,
					completedAt: block.completedAt ?? nowIso()
				}))
			};
			next = pushEvent(next, makeEvent(next, 'study_finished', 'dashboard', { phase: next.phase }));
		} else {
			throw new Error('Unsupported automation action');
		}

		next = pushEvent(next, makeEvent(next, `automation_${action}`, 'dashboard', { phase }));
		return persistSessionAndParticipant(next);
	});
}

export function emptyMapObject(type: MapObjectType): StudyMapObject {
	const isLine =
		type === 'wall' ||
		type === 'road' ||
		type === 'pedestrian_road' ||
		type === 'path' ||
		type === 'shuttle_path';
	return {
		id: makeId(type),
		type,
		label: type.replaceAll('_', ' '),
		x: 80,
		y: 80,
		width: type === 'zone' || type === 'obstacle' ? 92 : undefined,
		height: type === 'zone' || type === 'obstacle' ? 56 : undefined,
		x2: isLine ? 220 : undefined,
		y2: isLine ? 140 : undefined,
		size:
			type === 'wall'
				? 5
				: type === 'road'
					? 26
					: type === 'pedestrian_road'
						? 18
						: type === 'path'
							? 6
							: type === 'shuttle_path'
								? 7
								: type === 'label'
									? 13
									: 11,
		zIndex: defaultMapObjectZIndex(type)
	};
}

function defaultMapObjectZIndex(type: MapObjectType): number {
	if (type === 'obstacle' || type === 'zone') return 0;
	if (type === 'road') return 10;
	if (type === 'pedestrian_road') return 20;
	if (type === 'wall') return 30;
	if (type === 'shuttle_path') return 40;
	if (type === 'shuttle') return 50;
	if (type === 'path') return 70;
	if (type === 'participant_start' || type === 'label') return 80;
	if (type === 'pickup' || type === 'current_location') return 90;
	return 50;
}
