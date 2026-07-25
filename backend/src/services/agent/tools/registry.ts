/**
 * Agent tool registry.
 *
 * Every tool that an agent session may call must be registered here.
 * AgentExecutionService rejects any toolName not present in this map —
 * the LLM's requested tool name is NEVER trusted without an allowlist check.
 */

import { plannerGetTasks, plannerGetUpcomingDeadlines } from './read/plannerReadTools'
import { gpaGetCurrentGpa, gpaSimulateWhatIf, gpaGetGradesByCourse, gpaGetGradeHistory } from './read/gpaReadTools'
import {
  roadmapGetCurrentPlan,
  roadmapSuggestCourses,
  roadmapGetGraduationRequirements,
  roadmapGetCollegeReadiness,
} from './read/roadmapReadTools'
import {
  plannerCreateTask,
  plannerUpdateTask,
  plannerCompleteTask,
  plannerDeleteTask,
} from './write/plannerWriteTools'
import { roadmapApplyCourseChange } from './write/roadmapWriteTools'

export type AgentToolModule = 'PLANNER' | 'GPA' | 'ROADMAP' | 'CHAT'
export type AgentToolType = 'READ' | 'WRITE'

export interface ToolDefinition {
  readonly name: string
  readonly module: AgentToolModule
  readonly type: AgentToolType
  readonly rateLimitPerHour?: number
  execute(userId: number, input: unknown): Promise<unknown>
}

const tools: ToolDefinition[] = [
  // ── Planner read tools ────────────────────────────────────────────────
  {
    name: 'planner_get_tasks',
    module: 'PLANNER',
    type: 'READ',
    execute: (userId, input) => plannerGetTasks(userId, input),
  },
  {
    name: 'planner_get_upcoming_deadlines',
    module: 'PLANNER',
    type: 'READ',
    execute: (userId, input) => plannerGetUpcomingDeadlines(userId, input),
  },
  // ── GPA read tools ────────────────────────────────────────────────────
  {
    name: 'gpa_get_current_gpa',
    module: 'GPA',
    type: 'READ',
    execute: (userId, input) => gpaGetCurrentGpa(userId, input),
  },
  {
    name: 'gpa_simulate_what_if',
    module: 'GPA',
    type: 'READ',
    execute: (userId, input) => gpaSimulateWhatIf(userId, input),
  },
  {
    name: 'gpa_get_grades_by_course',
    module: 'GPA',
    type: 'READ',
    execute: (userId, input) => gpaGetGradesByCourse(userId, input),
  },
  {
    name: 'gpa_get_grade_history',
    module: 'GPA',
    type: 'READ',
    execute: (userId, input) => gpaGetGradeHistory(userId, input),
  },
  // ── Roadmap read tools ────────────────────────────────────────────────
  {
    name: 'roadmap_get_current_plan',
    module: 'ROADMAP',
    type: 'READ',
    execute: (userId, input) => roadmapGetCurrentPlan(userId, input),
  },
  {
    name: 'roadmap_suggest_courses',
    module: 'ROADMAP',
    type: 'READ',
    execute: (userId, input) => roadmapSuggestCourses(userId, input),
  },
  {
    name: 'roadmap_get_graduation_requirements',
    module: 'ROADMAP',
    type: 'READ',
    execute: (userId, input) => roadmapGetGraduationRequirements(userId, input),
  },
  {
    name: 'roadmap_get_college_readiness',
    module: 'ROADMAP',
    type: 'READ',
    execute: (userId, input) => roadmapGetCollegeReadiness(userId, input),
  },
  // ── Planner write tools ───────────────────────────────────────────────
  {
    name: 'planner_create_task',
    module: 'PLANNER',
    type: 'WRITE',
    rateLimitPerHour: 20,
    execute: (userId, input) => plannerCreateTask(userId, input),
  },
  {
    name: 'planner_update_task',
    module: 'PLANNER',
    type: 'WRITE',
    rateLimitPerHour: 30,
    execute: (userId, input) => plannerUpdateTask(userId, input),
  },
  {
    name: 'planner_complete_task',
    module: 'PLANNER',
    type: 'WRITE',
    rateLimitPerHour: 50,
    execute: (userId, input) => plannerCompleteTask(userId, input),
  },
  {
    name: 'planner_delete_task',
    module: 'PLANNER',
    type: 'WRITE',
    rateLimitPerHour: 10,
    execute: (userId, input) => plannerDeleteTask(userId, input),
  },
  // ── Roadmap write tools ───────────────────────────────────────────────
  {
    name: 'roadmap_apply_course_change',
    module: 'ROADMAP',
    type: 'WRITE',
    rateLimitPerHour: 5,
    execute: (userId, input) => roadmapApplyCourseChange(userId, input),
  },
]

export const toolRegistry: ReadonlyMap<string, ToolDefinition> = new Map(
  tools.map(t => [t.name, t]),
)

/**
 * Set of write-tool names — used by AgentExecutionService to block write
 * tools in SYSTEM-triggered sessions without depending on tool type lookups.
 */
export const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set(
  tools.filter(t => t.type === 'WRITE').map(t => t.name),
)
