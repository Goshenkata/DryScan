// Public surface: keep minimal API for consumers
export { DryScan, InitOptions } from './DryScan';
export { configStore } from './config/configStore';
export { loadDryConfig, saveDryConfig, resolveDryConfig, DryConfig, DEFAULT_CONFIG } from './config/dryconfig';
export {
	DuplicateAnalysisResult,
	DuplicateGroup,
	DuplicationScore,
	DuplicateSide,
	IndexUnit,
	IndexUnitType,
	DuplicateReport,
} from './types';
