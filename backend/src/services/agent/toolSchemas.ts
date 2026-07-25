/**
 * OpenAI-format tool definitions for the NextStep agentic AI layer.
 *
 * Each entry maps directly to a tool registered in registry.ts.
 * The `parameters` shapes match the Zod schemas inside the tool
 * implementation files (plannerWriteTools.ts, gpaReadTools.ts, etc.).
 *
 * These definitions are passed to createTieredChatCompletion via the
 * `tools` parameter (OpenAI function-calling format). The orchestrator
 * filters this list by module and trigger before calling the LLM —
 * SYSTEM sessions never see write-tool definitions, and PLANNER sessions
 * never see GPA tools, etc.
 */

import type { ChatCompletionFunctionTool } from 'openai/resources/chat/completions'
import { WRITE_TOOL_NAMES } from './tools/registry'

export type { ChatCompletionFunctionTool }

// ── Individual tool definitions ───────────────────────────────────────────────

const PLANNER_READ_TOOL_DEFS: ChatCompletionFunctionTool[] = [
  {
    type: 'function',
    function: {
      name: 'planner_get_tasks',
      description:
        'Retrieve the student\'s assignment list. Returns task details including title, subject, due date, estimated minutes, completion status, and priority. Use this to understand what tasks exist before suggesting changes.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['incomplete', 'complete', 'all'],
            description: "Filter tasks by completion status. Defaults to 'all'.",
          },
          limit: {
            type: 'number',
            description: 'Maximum number of tasks to return (1–50). Defaults to 20.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'planner_get_upcoming_deadlines',
      description:
        'Get the student\'s upcoming incomplete assignments within a date window, sorted by due date ascending. Use this to identify what is due soon.',
      parameters: {
        type: 'object',
        properties: {
          daysAhead: {
            type: 'number',
            description: 'Number of days ahead to look for deadlines (1–30). Defaults to 7.',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of deadlines to return (1–20). Defaults to 10.',
          },
        },
      },
    },
  },
]

const PLANNER_WRITE_TOOL_DEFS: ChatCompletionFunctionTool[] = [
  {
    type: 'function',
    function: {
      name: 'planner_create_task',
      description:
        'Create a new assignment or study task in the student\'s planner. Only create tasks the student explicitly asked for or clearly needs based on what they said.',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Task title (max 200 characters).',
          },
          subject: {
            type: 'string',
            description: 'Subject or course name (max 100 characters).',
          },
          dueDate: {
            type: 'string',
            description:
              "Due date in ISO 8601 format (e.g. '2026-07-20T23:59:00Z'). " +
              "Resolve any relative date phrases (e.g. 'tomorrow', 'next Friday', 'in 3 days') " +
              'using the current date provided in your system context.',
          },
          estimatedMinutes: {
            type: 'number',
            description: 'Estimated time to complete in minutes (0–480). Defaults to 30.',
          },
          priority: {
            type: 'string',
            enum: ['LOW', 'MEDIUM', 'HIGH'],
            description: 'Task priority (optional).',
          },
        },
        required: ['title', 'subject', 'dueDate'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'planner_update_task',
      description:
        'Update one or more fields on an existing task. Only provide the fields you want to change. Read tasks first to confirm the task ID before updating.',
      parameters: {
        type: 'object',
        properties: {
          taskId: {
            type: 'number',
            description: 'The ID of the task to update.',
          },
          title: {
            type: 'string',
            description: 'New task title (optional, max 200 characters).',
          },
          subject: {
            type: 'string',
            description: 'New subject (optional, max 100 characters).',
          },
          dueDate: {
            type: 'string',
            description:
              'New due date in ISO 8601 format (optional). ' +
              "Resolve relative phrases (e.g. 'tomorrow', 'next Monday') using the current date in your system context.",
          },
          estimatedMinutes: {
            type: 'number',
            description: 'New estimated time in minutes (optional, 0–480).',
          },
          priority: {
            type: 'string',
            enum: ['LOW', 'MEDIUM', 'HIGH'],
            description: 'New priority (optional).',
          },
        },
        required: ['taskId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'planner_complete_task',
      description:
        'Mark an existing task as completed. Use only when the student says a task is done.',
      parameters: {
        type: 'object',
        properties: {
          taskId: {
            type: 'number',
            description: 'The ID of the task to mark as completed.',
          },
        },
        required: ['taskId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'planner_delete_task',
      description:
        'Permanently delete a task from the student\'s planner. This cannot be undone. Only delete tasks the student explicitly asked to remove.',
      parameters: {
        type: 'object',
        properties: {
          taskId: {
            type: 'number',
            description: 'The ID of the task to delete.',
          },
        },
        required: ['taskId'],
      },
    },
  },
]

const GPA_READ_TOOL_DEFS: ChatCompletionFunctionTool[] = [
  {
    type: 'function',
    function: {
      name: 'gpa_get_current_gpa',
      description:
        "Get the student's current weighted and unweighted GPA based on their grades for the current grading period. Returns null if no grades are on file.",
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'gpa_simulate_what_if',
      description:
        "Simulate the effect of hypothetical grade changes on the student's GPA. Pass one or more {courseId, letterGrade} pairs to see how the GPA would change. The student must provide course IDs — read their course list first if needed.",
      parameters: {
        type: 'object',
        properties: {
          hypotheticalGrades: {
            type: 'array',
            description:
              'Array of course ID and hypothetical letter grade pairs.',
            items: {
              type: 'object',
              properties: {
                courseId: {
                  type: 'number',
                  description: 'The course ID.',
                },
                letterGrade: {
                  type: 'string',
                  description:
                    "The hypothetical letter grade (e.g. 'A', 'B+', 'C').",
                },
              },
              required: ['courseId', 'letterGrade'],
            },
          },
        },
        required: ['hypotheticalGrades'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'gpa_get_grades_by_course',
      description:
        "Get the student's current grades broken down by course, including course name, type, credit hours, letter grade, and percentage.",
      parameters: {
        type: 'object',
        properties: {
          gradingPeriod: {
            type: 'string',
            description:
              "The grading period to query (defaults to 'CURRENT'). Use only if the student asks about a specific period.",
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'gpa_get_grade_history',
      description:
        "Get the student's grade history across all grading periods, optionally filtered to a specific course.",
      parameters: {
        type: 'object',
        properties: {
          courseId: {
            type: 'number',
            description:
              'Optional course ID to filter history to a single class. Omit to get all course history.',
          },
        },
      },
    },
  },
]

const ROADMAP_READ_TOOL_DEFS: ChatCompletionFunctionTool[] = [
  {
    type: 'function',
    function: {
      name: 'roadmap_get_current_plan',
      description:
        "Get the student's current academic roadmap snapshot: grade level, graduation year, credits completed vs required, GPA, credit breakdown by category, and future decisions on file.",
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'roadmap_suggest_courses',
      description:
        "Get rule-based course suggestions to fill the student's credit gaps toward graduation requirements. Returns which categories have deficits and specific course suggestions for each.",
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'roadmap_get_graduation_requirements',
      description:
        "Get the student's graduation requirement progress by category: credits required, credits earned, credits remaining, and whether each category is met.",
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'roadmap_get_college_readiness',
      description:
        "Get an overall college readiness assessment: a readiness score (0–100) and signal-by-signal breakdown across GPA, credit progress, course rigor, test scores, and college list size.",
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
]

const ROADMAP_WRITE_TOOL_DEFS: ChatCompletionFunctionTool[] = [
  {
    type: 'function',
    function: {
      name: 'roadmap_apply_course_change',
      description:
        "Apply a permanent change to a course in the student's roadmap. Changes either the course type (STANDARD, HONORS, AP, IB) or credit hours. Requires a rationale explaining why the change is appropriate. Only use this when the student explicitly asks to modify their course record.",
      parameters: {
        type: 'object',
        properties: {
          courseId: {
            type: 'number',
            description: 'The ID of the course to modify.',
          },
          field: {
            type: 'string',
            enum: ['courseType', 'creditHours'],
            description: 'The field to change.',
          },
          newValue: {
            type: 'string',
            description:
              "The new value. For courseType: STANDARD, HONORS, AP, or IB. For creditHours: a decimal number as a string (e.g. '1.0', '0.5').",
          },
          rationale: {
            type: 'string',
            description:
              'A brief explanation for why this change is being made (10–500 characters).',
          },
        },
        required: ['courseId', 'field', 'newValue', 'rationale'],
      },
    },
  },
]

// ── Module-to-tool-definition maps ────────────────────────────────────────────

/** All tool definitions grouped by whether they are read or write. */
export const ALL_READ_TOOL_DEFS: ChatCompletionFunctionTool[] = [
  ...PLANNER_READ_TOOL_DEFS,
  ...GPA_READ_TOOL_DEFS,
  ...ROADMAP_READ_TOOL_DEFS,
]

export const ALL_WRITE_TOOL_DEFS: ChatCompletionFunctionTool[] = [
  ...PLANNER_WRITE_TOOL_DEFS,
  ...ROADMAP_WRITE_TOOL_DEFS,
]

/** Combined tool definitions per module (read + write, before trigger filtering). */
export const MODULE_TOOL_DEFS: Record<'PLANNER' | 'GPA' | 'ROADMAP' | 'CHAT', ChatCompletionFunctionTool[]> = {
  PLANNER: [...PLANNER_READ_TOOL_DEFS, ...PLANNER_WRITE_TOOL_DEFS],
  GPA: [...GPA_READ_TOOL_DEFS],
  ROADMAP: [...ROADMAP_READ_TOOL_DEFS, ...ROADMAP_WRITE_TOOL_DEFS],
  CHAT: [...ALL_READ_TOOL_DEFS, ...ALL_WRITE_TOOL_DEFS],
}

/**
 * Returns the tool definitions to pass to the LLM for a given module and
 * trigger. For SYSTEM sessions, all write tool definitions are stripped
 * before the model ever sees them — defense in depth on top of the dispatch
 * layer's enforcement in AgentExecutionService.
 *
 * `roadmap_apply_course_change` is always absent from SYSTEM tool lists
 * because it is a WRITE tool and SYSTEM sessions get no write tools.
 */
export function getToolDefsForSession(
  module: 'PLANNER' | 'GPA' | 'ROADMAP' | 'CHAT',
  trigger: 'USER' | 'SYSTEM',
): ChatCompletionFunctionTool[] {
  const allDefs = MODULE_TOOL_DEFS[module]
  if (trigger === 'SYSTEM') {
    return allDefs.filter(t => !WRITE_TOOL_NAMES.has(t.function.name))
  }
  return allDefs
}

/** Set of write-tool names for quick lookup — mirrors WRITE_TOOL_NAMES from registry. */
export { WRITE_TOOL_NAMES }
