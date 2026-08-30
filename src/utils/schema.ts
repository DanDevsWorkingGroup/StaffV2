/**
 * Description of the D1 schema, used by the Supabase-compatible query shim to
 * validate columns, decode Postgres-shaped values, and resolve embedded
 * resources (PostgREST's `select('*, roles(name)')` syntax).
 *
 * Kept in step with migrations/0001_schema.sql by hand — it is small enough
 * that a runtime PRAGMA lookup would cost more than it is worth.
 */

export type TableName =
  | 'users'
  | 'sessions'
  | 'roles'
  | 'permissions'
  | 'role_permissions'
  | 'regions'
  | 'trainers'
  | 'events'
  | 'schedules'
  | 'physical_training'
  | 'religious_activities'
  | 'dormitory_assignments'
  | 'dormitory_visitors'
  | 'training_sessions'
  | 'event_trainer_schedule'

export const TABLE_COLUMNS: Record<TableName, Array<string>> = {
  users: [
    'id', 'email', 'password_hash', 'email_confirmed_at', 'created_at',
    'updated_at', 'last_sign_in_at', 'raw_user_meta_data',
  ],
  sessions: ['id', 'user_id', 'created_at', 'expires_at', 'user_agent'],
  roles: ['id', 'name', 'description', 'level', 'created_at', 'updated_at'],
  permissions: ['id', 'name', 'resource', 'action', 'description', 'created_at'],
  role_permissions: ['id', 'role_id', 'permission_id', 'created_at'],
  regions: ['id', 'name', 'code', 'training_centers', 'active_trainers'],
  trainers: [
    'id', 'name', 'rank', 'status', 'specialization', 'created_at', 'role_id',
    'is_active', 'last_login', 'user_id', 'region', 'updated_at', 'department',
  ],
  events: [
    'id', 'name', 'category', 'start_date', 'end_date', 'description', 'color',
    'created_at',
  ],
  schedules: [
    'id', 'trainer_id', 'date', 'availability', 'status', 'notes', 'created_at',
    'updated_at',
  ],
  physical_training: [
    'id', 'date', 'training_type', 'in_charge', 'participants', 'time_slot',
    'created_at',
  ],
  religious_activities: [
    'id', 'date', 'activity', 'in_charge', 'participants', 'created_at',
  ],
  dormitory_assignments: [
    'id', 'room_id', 'trainer_id', 'visitor_id', 'check_in', 'check_out', 'status',
    'created_at',
  ],
  dormitory_visitors: [
    'id', 'name', 'organization', 'phone', 'id_number', 'notes', 'created_at',
  ],
  training_sessions: [
    'id', 'date', 'type', 'trainer_id', 'status', 'time_slot', 'created_at',
  ],
  event_trainer_schedule: ['id', 'event_id', 'trainer_id', 'created_at'],
}

/**
 * Postgres array columns are stored as TEXT holding a JSON array. They are
 * decoded back into real arrays on read so components keep seeing what
 * PostgREST used to hand them.
 */
export const JSON_ARRAY_COLUMNS: Partial<Record<TableName, Array<string>>> = {
  schedules: ['availability'],
  physical_training: ['participants'],
  religious_activities: ['participants'],
}

/** Postgres booleans are stored as INTEGER 0/1. */
export const BOOLEAN_COLUMNS: Partial<Record<TableName, Array<string>>> = {
  trainers: ['is_active'],
}

/** JSON object columns (stored as TEXT). */
export const JSON_OBJECT_COLUMNS: Partial<Record<TableName, Array<string>>> = {
  users: ['raw_user_meta_data'],
}

/**
 * Foreign keys backing PostgREST embedded resources, keyed
 * `"<baseTable>:<embeddedTable>"`. Every embed in this app is to-one.
 */
export const EMBED_FOREIGN_KEYS: Record<string, string> = {
  'trainers:roles': 'role_id',
  'trainers:users': 'user_id',
  'schedules:trainers': 'trainer_id',
  'dormitory_assignments:trainers': 'trainer_id',
  'dormitory_assignments:dormitory_visitors': 'visitor_id',
  'training_sessions:trainers': 'trainer_id',
  'role_permissions:permissions': 'permission_id',
  'role_permissions:roles': 'role_id',
  'event_trainer_schedule:trainers': 'trainer_id',
  'event_trainer_schedule:events': 'event_id',
}

export function isTable(name: string): name is TableName {
  return Object.prototype.hasOwnProperty.call(TABLE_COLUMNS, name)
}

export function hasColumn(table: TableName, column: string): boolean {
  return TABLE_COLUMNS[table].includes(column)
}
