import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from '~/utils/supabase'
import { resolveUserRole, checkRole } from '~/middleware/rbac'
import { useMemo, useState } from 'react'
import { useCanManageDormitory } from '~/hooks/useRBAC'

// Types for dormitory structure
type BuildingType = 'ANGGERIK' | 'BOUGANVILLA' | 'RAFLESIA' | 'SEROJA' | 'LESTARI_4' | 'LESTARI_5' | 'LESTARI_6'
type RoomType = 'standard' | 'vip' | 'quarters'

interface DormitoryBuilding {
  name: BuildingType
  type: RoomType
  displayName: string
  color: string
  floors: Floor[]
}

interface Floor {
  floorNumber: number
  floorName: string
  rooms: Room[]
}

interface Room {
  id: string
  roomNumber: number
  capacity: number
  building: BuildingType
  floor: number
  type: RoomType
}

const DORMITORY_MANAGER_ROLES = ['ADMIN', 'COORDINATOR', 'DORMITORY COORDINATOR'] as const

// Server function to fetch dormitory data
const getDormitoryData = createServerFn({ method: 'GET' }).handler(async () => {
  const supabase = getSupabaseServerClient()

  const { data: assignments } = await supabase
    .from('dormitory_assignments')
    .select(`
      *,
      trainer:trainers(id, name, rank),
      visitor:dormitory_visitors(id, name, organization, phone, id_number, notes, batch_id)
    `)
    .order('room_id', { ascending: true })

  const { data: trainers } = await supabase
    .from('trainers')
    .select('*')
    .eq('status', 'active')

  // Calculate statistics based on actual structure
  const buildings = generateAllBuildings()
  const totalRooms = buildings.reduce((sum, building) =>
    sum + building.floors.reduce((floorSum, floor) =>
      floorSum + floor.rooms.length, 0
    ), 0
  )

  const totalCapacity = buildings.reduce((sum, building) =>
    sum + building.floors.reduce((floorSum, floor) =>
      floorSum + floor.rooms.reduce((roomSum, room) =>
        roomSum + room.capacity, 0
      ), 0
    ), 0
  )

  const occupiedRooms = new Set(assignments?.map(a => a.room_id)).size
  const currentOccupancy = assignments?.length || 0

  return {
    assignments: assignments || [],
    trainers: trainers || [],
    stats: {
      totalRooms,
      occupiedRooms,
      availableRooms: totalRooms - occupiedRooms,
      totalCapacity,
      currentOccupancy,
      occupancyRate: Math.round((currentOccupancy / totalCapacity) * 100)
    }
  }
})

// ---------------------------------------------------------------------------
// Shared helper: flat catalog of every room, used to validate assignment
// targets and to distribute people across a building.
// ---------------------------------------------------------------------------
function roomCatalog(): Map<string, { id: string; capacity: number; building: BuildingType; floor: number }> {
  const map = new Map<string, { id: string; capacity: number; building: BuildingType; floor: number }>()
  for (const building of generateAllBuildings()) {
    for (const floor of building.floors) {
      for (const room of floor.rooms) {
        map.set(room.id, {
          id: room.id,
          capacity: room.capacity,
          building: building.name,
          floor: floor.floorNumber,
        })
      }
    }
  }
  return map
}

/**
 * Resolve an assignment target into an ordered list of candidate rooms:
 *   - "room:<id>"            a single specific room
 *   - "auto:<BUILDING>"      spread across a whole building
 *   - "floor:<BUILDING>:<n>" spread across one floor of a building
 * The catalog is built ground-floor-first, so the natural iteration order is a
 * sensible fill order.
 */
function resolveTargetRooms(target: string): Array<{ id: string; capacity: number }> {
  const catalog = roomCatalog()
  if (target.startsWith('room:')) {
    const room = catalog.get(target.slice(5))
    return room ? [room] : []
  }
  if (target.startsWith('auto:')) {
    const building = target.slice(5)
    return [...catalog.values()].filter((r) => r.building === building)
  }
  if (target.startsWith('floor:')) {
    const [, building, floorStr] = target.split(':')
    const floor = Number(floorStr)
    return [...catalog.values()].filter((r) => r.building === building && r.floor === floor)
  }
  return []
}

// Server function to assign one or more trainers to a room (or across a building)
const assignTrainersBulk = createServerFn({ method: 'POST' })
  .inputValidator((data: { trainerIds: number[]; target: string }) => data)
  .handler(async ({ data }) => {
    checkRole(await resolveUserRole(), [...DORMITORY_MANAGER_ROLES])

    const trainerIds = [...new Set(data.trainerIds)].filter((id) => Number.isFinite(id))
    if (trainerIds.length === 0) {
      return { error: 'Select at least one trainer to assign.' }
    }

    const rooms = resolveTargetRooms(data.target)
    if (rooms.length === 0) {
      return { error: 'Choose a valid room or building to assign into.' }
    }

    const supabase = getSupabaseServerClient()

    // Current occupancy per room, so we never exceed capacity.
    const { data: existing } = await supabase
      .from('dormitory_assignments')
      .select('room_id, trainer_id')

    const occupancy = new Map<string, number>()
    const alreadyAssigned = new Set<number>()
    for (const row of existing || []) {
      occupancy.set(row.room_id, (occupancy.get(row.room_id) || 0) + 1)
      if (row.trainer_id != null) alreadyAssigned.add(row.trainer_id)
    }

    const queue = trainerIds.filter((id) => !alreadyAssigned.has(id))
    const skipped = trainerIds.length - queue.length

    const now = new Date().toISOString()
    const toInsert: Array<Record<string, unknown>> = []
    for (const room of rooms) {
      let free = room.capacity - (occupancy.get(room.id) || 0)
      while (free > 0 && queue.length > 0) {
        toInsert.push({
          trainer_id: queue.shift(),
          room_id: room.id,
          check_in: now,
          status: 'active',
        })
        free--
      }
      if (queue.length === 0) break
    }

    if (toInsert.length > 0) {
      const { error } = await supabase.from('dormitory_assignments').insert(toInsert)
      if (error) throw new Error(error.message)
    }

    return {
      success: true,
      assigned: toInsert.length,
      unplaced: queue.length,
      skipped,
    }
  })

// Server function to create a temporary visitor and place them in a room
const createAndAssignVisitor = createServerFn({ method: 'POST' })
  .inputValidator((data: {
    name: string
    organization: string
    phone: string
    id_number: string
    notes: string
    roomId: string
  }) => data)
  .handler(async ({ data }) => {
    checkRole(await resolveUserRole(), [...DORMITORY_MANAGER_ROLES])

    const name = data.name.trim()
    if (!name) return { error: 'Visitor name is required.' }

    const room = roomCatalog().get(data.roomId)
    if (!room) return { error: 'Choose a valid room for the visitor.' }

    const supabase = getSupabaseServerClient()

    const { data: existing } = await supabase
      .from('dormitory_assignments')
      .select('room_id')
      .eq('room_id', data.roomId)
    if ((existing?.length || 0) >= room.capacity) {
      return { error: 'That room is already full.' }
    }

    const { data: visitor, error: visitorError } = await supabase
      .from('dormitory_visitors')
      .insert({
        name,
        organization: data.organization.trim() || null,
        phone: data.phone.trim() || null,
        id_number: data.id_number.trim() || null,
        notes: data.notes.trim() || null,
      })
      .select()
      .single()

    if (visitorError || !visitor) {
      throw new Error(visitorError?.message || 'Failed to create visitor')
    }

    const { error } = await supabase.from('dormitory_assignments').insert({
      visitor_id: visitor.id,
      room_id: data.roomId,
      check_in: new Date().toISOString(),
      status: 'active',
    })
    if (error) throw new Error(error.message)

    return { success: true }
  })

const MASS_VISITOR_LIMIT = 500

// Server function to check a whole party of visitors from one organization into
// a floor or a building at once. Creates one visitor record per person (name =
// organization) and one assignment per bed, all sharing a batch_id.
const massAssignVisitors = createServerFn({ method: 'POST' })
  .inputValidator((data: {
    organization: string
    phone: string
    notes: string
    target: string
    count: number // <= 0 means "fill every free bed in the target"
  }) => data)
  .handler(async ({ data }) => {
    checkRole(await resolveUserRole(), [...DORMITORY_MANAGER_ROLES])

    const organization = data.organization.trim()
    if (!organization) return { error: 'Organization name is required.' }

    const rooms = resolveTargetRooms(data.target)
    if (rooms.length === 0) {
      return { error: 'Choose a building or floor to assign into.' }
    }

    const supabase = getSupabaseServerClient()

    const { data: existing } = await supabase
      .from('dormitory_assignments')
      .select('room_id')

    const occupancy = new Map<string, number>()
    for (const row of existing || []) {
      occupancy.set(row.room_id, (occupancy.get(row.room_id) || 0) + 1)
    }

    const freeByRoom = rooms.map((r) => ({
      id: r.id,
      free: Math.max(0, r.capacity - (occupancy.get(r.id) || 0)),
    }))
    const totalFree = freeByRoom.reduce((sum, r) => sum + r.free, 0)
    if (totalFree === 0) {
      return { error: 'The selected target has no free beds.' }
    }

    const requested = data.count > 0 ? Math.floor(data.count) : totalFree
    if (requested > MASS_VISITOR_LIMIT) {
      return { error: `Too many at once — assign at most ${MASS_VISITOR_LIMIT} visitors per action.` }
    }

    const toPlace = Math.min(requested, totalFree)
    const unplaced = Math.max(0, requested - toPlace)

    const batchId = crypto.randomUUID()
    const now = new Date().toISOString()

    const visitorRows = Array.from({ length: toPlace }, () => ({
      name: organization,
      organization,
      phone: data.phone.trim() || null,
      notes: data.notes.trim() || null,
      batch_id: batchId,
    }))

    const { data: createdVisitors, error: visitorError } = await supabase
      .from('dormitory_visitors')
      .insert(visitorRows)
      .select()

    if (visitorError || !createdVisitors || createdVisitors.length === 0) {
      throw new Error(visitorError?.message || 'Failed to create visitor records')
    }

    const assignmentRows: Array<Record<string, unknown>> = []
    let vi = 0
    for (const room of freeByRoom) {
      for (let i = 0; i < room.free && vi < createdVisitors.length; i++) {
        assignmentRows.push({
          visitor_id: createdVisitors[vi].id,
          room_id: room.id,
          check_in: now,
          status: 'active',
        })
        vi++
      }
    }

    const { error: assignError } = await supabase
      .from('dormitory_assignments')
      .insert(assignmentRows)

    if (assignError) {
      // Roll back the visitor records we just created so nothing is orphaned.
      await supabase.from('dormitory_visitors').delete().eq('batch_id', batchId)
      throw new Error(assignError.message)
    }

    return {
      success: true,
      assigned: assignmentRows.length,
      unplaced,
      roomsUsed: new Set(assignmentRows.map((r) => r.room_id)).size,
    }
  })

// Server function to check out an entire visitor group (all records sharing a
// batch_id) in one step.
const checkOutVisitorGroup = createServerFn({ method: 'POST' })
  .inputValidator((data: { batchId: string }) => data)
  .handler(async ({ data }) => {
    checkRole(await resolveUserRole(), [...DORMITORY_MANAGER_ROLES])

    const supabase = getSupabaseServerClient()

    const { data: visitors } = await supabase
      .from('dormitory_visitors')
      .select('id')
      .eq('batch_id', data.batchId)

    const ids = (visitors || []).map((v) => v.id)
    if (ids.length === 0) {
      return { error: 'That visitor group no longer exists.' }
    }

    // Chunk the assignment delete so the IN (...) list stays within D1's
    // bound-parameter limit.
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50)
      const { error } = await supabase
        .from('dormitory_assignments')
        .delete()
        .in('visitor_id', chunk)
      if (error) throw new Error(error.message)
    }

    await supabase.from('dormitory_visitors').delete().eq('batch_id', data.batchId)

    return { success: true, removed: ids.length }
  })

// Server function to remove an assignment (trainer or visitor) from a room
const removeAssignment = createServerFn({ method: 'POST' })
  .inputValidator((data: { assignmentId: number }) => data)
  .handler(async ({ data }) => {
    checkRole(await resolveUserRole(), [...DORMITORY_MANAGER_ROLES])

    const supabase = getSupabaseServerClient()

    // Look up the row first so a visitor can be fully checked out (their
    // temporary record is deleted along with the assignment).
    const { data: assignment } = await supabase
      .from('dormitory_assignments')
      .select('id, visitor_id')
      .eq('id', data.assignmentId)
      .single()

    const { error } = await supabase
      .from('dormitory_assignments')
      .delete()
      .eq('id', data.assignmentId)

    if (error) {
      throw new Error(error.message)
    }

    if (assignment?.visitor_id != null) {
      await supabase.from('dormitory_visitors').delete().eq('id', assignment.visitor_id)
    }

    return { success: true }
  })

export const Route = createFileRoute('/_authed/dormitory/')({
  beforeLoad: ({ context }) => {
    if (!context.user?.role || !DORMITORY_MANAGER_ROLES.includes(context.user.role as any)) {
      throw new Error('Unauthorized Access: Only ADMIN, COORDINATOR, and DORMITORY COORDINATOR can access dormitory management')
    }
  },
  loader: async () => await getDormitoryData(),
  component: DormitoryPage,
})

// Generate complete building structure
function generateAllBuildings(): DormitoryBuilding[] {
  const buildings: DormitoryBuilding[] = []

  // Complete color map for all buildings
  const buildingColors: Record<BuildingType, string> = {
    'ANGGERIK': 'bg-purple-100 border-purple-300',
    'BOUGANVILLA': 'bg-pink-100 border-pink-300',
    'RAFLESIA': 'bg-red-100 border-red-300',
    'SEROJA': 'bg-yellow-100 border-yellow-300',
    'LESTARI_4': 'bg-green-100 border-green-300',
    'LESTARI_5': 'bg-teal-100 border-teal-300',
    'LESTARI_6': 'bg-cyan-100 border-cyan-300'
  }

  // Standard dormitories: ANGGERIK, BOUGANVILLA, RAFLESIA
  const standardDorms: BuildingType[] = ['ANGGERIK', 'BOUGANVILLA', 'RAFLESIA']

  standardDorms.forEach(dormName => {
    const floors: Floor[] = []

    // Ground floor - 8 rooms
    const groundFloorRooms: Room[] = []
    for (let i = 1; i <= 8; i++) {
      groundFloorRooms.push({
        id: `${dormName}-G-${i}`,
        roomNumber: i,
        capacity: 2,
        building: dormName,
        floor: 0,
        type: 'standard'
      })
    }
    floors.push({
      floorNumber: 0,
      floorName: 'Ground Floor',
      rooms: groundFloorRooms
    })

    // Floors 1, 2, 3 - 24 rooms each
    for (let floor = 1; floor <= 3; floor++) {
      const floorRooms: Room[] = []
      for (let i = 1; i <= 24; i++) {
        floorRooms.push({
          id: `${dormName}-F${floor}-${i}`,
          roomNumber: i,
          capacity: 2,
          building: dormName,
          floor: floor,
          type: 'standard'
        })
      }
      floors.push({
        floorNumber: floor,
        floorName: `Floor ${floor}`,
        rooms: floorRooms
      })
    }

    buildings.push({
      name: dormName,
      type: 'standard',
      displayName: dormName,
      color: buildingColors[dormName],
      floors
    })
  })

  // SEROJA - VIP dormitory
  const serojaFloors: Floor[] = []

  // Ground floor - 8 rooms, 2 beds each
  const serojaGroundRooms: Room[] = []
  for (let i = 1; i <= 8; i++) {
    serojaGroundRooms.push({
      id: `SEROJA-G-${i}`,
      roomNumber: i,
      capacity: 2,
      building: 'SEROJA',
      floor: 0,
      type: 'standard'
    })
  }
  serojaFloors.push({
    floorNumber: 0,
    floorName: 'Ground Floor',
    rooms: serojaGroundRooms
  })

  // Floor 1 - 24 rooms, VIP (1 person each)
  const serojaVIPRooms: Room[] = []
  for (let i = 1; i <= 24; i++) {
    serojaVIPRooms.push({
      id: `SEROJA-F1-${i}`,
      roomNumber: i,
      capacity: 1, // VIP - 1 person only
      building: 'SEROJA',
      floor: 1,
      type: 'vip'
    })
  }
  serojaFloors.push({
    floorNumber: 1,
    floorName: 'Floor 1 (VIP)',
    rooms: serojaVIPRooms
  })

  // Floors 2, 3 - 24 rooms each, 2 beds
  for (let floor = 2; floor <= 3; floor++) {
    const floorRooms: Room[] = []
    for (let i = 1; i <= 24; i++) {
      floorRooms.push({
        id: `SEROJA-F${floor}-${i}`,
        roomNumber: i,
        capacity: 2,
        building: 'SEROJA',
        floor: floor,
        type: 'standard'
      })
    }
    serojaFloors.push({
      floorNumber: floor,
      floorName: `Floor ${floor}`,
      rooms: floorRooms
    })
  }

  buildings.push({
    name: 'SEROJA',
    type: 'vip',
    displayName: 'SEROJA (VIP)',
    color: buildingColors['SEROJA'],
    floors: serojaFloors
  })

  // LESTARI 4, 5, 6 - Quarters
  const lestariBuildings: BuildingType[] = ['LESTARI_4', 'LESTARI_5', 'LESTARI_6']

  lestariBuildings.forEach((lestariName, index) => {
    const floors: Floor[] = []
    const houses: Room[] = []

    // 15 houses per LESTARI building, 8 capacity each
    for (let i = 1; i <= 15; i++) {
      houses.push({
        id: `${lestariName}-H${i}`,
        roomNumber: i,
        capacity: 8,
        building: lestariName,
        floor: 0, // Quarters are single-story houses
        type: 'quarters'
      })
    }

    floors.push({
      floorNumber: 0,
      floorName: 'Houses',
      rooms: houses
    })

    buildings.push({
      name: lestariName,
      type: 'quarters',
      displayName: `LESTARI ${index + 4}`,
      color: buildingColors[lestariName],
      floors
    })
  })

  return buildings
}

// Derive a display-friendly occupant from an assignment row.
function occupantOf(assignment: any): { name: string; sub: string; kind: 'trainer' | 'visitor' } | null {
  if (!assignment) return null
  if (assignment.trainer) {
    return { name: assignment.trainer.name, sub: assignment.trainer.rank || '', kind: 'trainer' }
  }
  if (assignment.visitor) {
    const { name, organization } = assignment.visitor
    return {
      name,
      sub: organization && organization !== name ? organization : 'Visitor',
      kind: 'visitor',
    }
  }
  return null
}

function DormitoryPage() {
  const router = useRouter()
  const { assignments, trainers, stats } = Route.useLoaderData()
  const [selectedBuilding, setSelectedBuilding] = useState<BuildingType | ''>('')
  const [selectedFloor, setSelectedFloor] = useState<number | 'all'>('all')
  const [searchTerm, setSearchTerm] = useState('')

  const canManage = useCanManageDormitory()

  const [isRemoving, setIsRemoving] = useState(false)

  // Group assignments by room
  const roomAssignments = assignments.reduce((acc: any, assignment: any) => {
    const roomId = assignment.room_id
    if (!acc[roomId]) {
      acc[roomId] = []
    }
    acc[roomId].push(assignment)
    return acc
  }, {})

  // Get all buildings
  const allBuildings = generateAllBuildings()

  // Get selected building data
  const selectedBuildingData = selectedBuilding === ''
    ? null
    : allBuildings.find(b => b.name === selectedBuilding)

  // Get available floors for selected building
  const availableFloors = selectedBuildingData
    ? selectedBuildingData.floors
    : []

  // Get all rooms with assignments
  const getAllRooms = () => {
    const rooms: any[] = []

    allBuildings.forEach(building => {
      building.floors.forEach(floor => {
        floor.rooms.forEach(room => {
          rooms.push({
            ...room,
            buildingDisplayName: building.displayName,
            buildingColor: building.color,
            floorName: floor.floorName,
            assignments: roomAssignments[room.id] || []
          })
        })
      })
    })

    return rooms
  }

  const allRooms = getAllRooms()

  // Filter rooms - only show if building is selected
  const filteredRooms = selectedBuilding === ''
    ? []
    : allRooms.filter(room => {
      const matchesBuilding = room.building === selectedBuilding
      const matchesFloor = selectedFloor === 'all' || room.floor === selectedFloor

      if (!matchesBuilding || !matchesFloor) return false

      if (searchTerm) {
        return room.assignments.some((a: any) => {
          const occ = occupantOf(a)
          return occ?.name.toLowerCase().includes(searchTerm.toLowerCase())
        })
      }

      return true
    })

  // Get unassigned trainers
  const unassignedTrainers = trainers.filter((trainer: any) =>
    !assignments.some((a: any) => a.trainer?.id === trainer.id)
  )

  // Current visitors (derived from active assignments that point at a visitor)
  const visitorAssignments = assignments.filter((a: any) => a.visitor)

  // Rooms that still have a free bed, in a stable order for the pickers
  const availableRooms = allRooms
    .filter((room) => room.assignments.length < room.capacity)
    .map((room) => ({
      id: room.id,
      label: room.type === 'quarters'
        ? `${room.buildingDisplayName} - House ${room.roomNumber}`
        : `${room.buildingDisplayName} - ${room.floorName} - Room ${room.roomNumber}`,
      free: room.capacity - room.assignments.length,
      capacity: room.capacity,
      vip: room.type === 'vip',
    }))

  // Free beds per building, for the "auto-fill" targets
  const buildingFreeBeds = allBuildings.map((building) => {
    const rooms = allRooms.filter((r) => r.building === building.name)
    const free = rooms.reduce((sum, r) => sum + (r.capacity - r.assignments.length), 0)
    return { name: building.name, displayName: building.displayName, free }
  })

  // Free beds per floor, for the "whole floor" targets (skipped for buildings
  // that only have one floor, where it would just duplicate the building option)
  const floorFreeBeds = allBuildings.flatMap((building) =>
    building.floors.length <= 1
      ? []
      : building.floors.map((floor) => ({
          building: building.name,
          buildingDisplayName: building.displayName,
          floor: floor.floorNumber,
          floorName: floor.floorName,
          free: allRooms
            .filter((r) => r.building === building.name && r.floor === floor.floorNumber)
            .reduce((sum, r) => sum + (r.capacity - r.assignments.length), 0),
        })),
  )

  // Handle remove trainer/visitor
  const handleRemove = async (assignmentId: number) => {
    if (!confirm('Remove this occupant from the room?')) {
      return
    }

    setIsRemoving(true)
    try {
      await removeAssignment({ data: { assignmentId } })
      await router.invalidate()
    } catch (error) {
      alert('Failed to remove occupant: ' + (error as Error).message)
    } finally {
      setIsRemoving(false)
    }
  }

  // Check out a whole visitor group at once
  const handleRemoveGroup = async (batchId: string) => {
    if (!confirm('Check out this entire visitor group?')) {
      return
    }

    setIsRemoving(true)
    try {
      await checkOutVisitorGroup({ data: { batchId } })
      await router.invalidate()
    } catch (error) {
      alert('Failed to check out group: ' + (error as Error).message)
    } finally {
      setIsRemoving(false)
    }
  }

  // Reset floor when building changes
  const handleBuildingChange = (building: BuildingType | '') => {
    setSelectedBuilding(building)
    setSelectedFloor('all')
  }


  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow p-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Dormitory Management</h1>
        <p className="text-gray-600">
          Select a building below to view and manage room assignments
        </p>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          title="Total Rooms"
          value={stats.totalRooms}
          icon="🏢"
          color="bg-blue-500"
        />
        <StatCard
          title="Occupied Rooms"
          value={stats.occupiedRooms}
          icon="🔒"
          color="bg-green-500"
        />
        <StatCard
          title="Available Rooms"
          value={stats.availableRooms}
          icon="🔓"
          color="bg-yellow-500"
        />
        <StatCard
          title="Occupancy Rate"
          value={`${stats.occupancyRate}%`}
          icon="📊"
          color="bg-purple-500"
        />
      </div>

      {/* Building Overview Cards */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Select a Building</h2>
        <p className="text-gray-600 mb-4 text-sm">Click on any building below to view its room layout</p>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {allBuildings.map(building => {
            const buildingRooms = allRooms.filter(r => r.building === building.name)
            const totalCapacity = buildingRooms.reduce((sum, r) => sum + r.capacity, 0)
            const occupied = buildingRooms.reduce((sum, r) => sum + r.assignments.length, 0)
            const occupancyRate = Math.round((occupied / totalCapacity) * 100)
            const isSelected = selectedBuilding === building.name

            return (
              <div
                key={building.name}
                className={`${building.color} rounded-lg p-4 cursor-pointer hover:shadow-lg hover:scale-105 transition-all ${isSelected
                  ? 'ring-4 ring-blue-600 shadow-lg scale-105'
                  : 'hover:ring-2 hover:ring-blue-400'
                  }`}
                onClick={() => handleBuildingChange(building.name)}
              >
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-lg">{building.displayName}</h3>
                  {isSelected && (
                    <span className="bg-blue-600 text-white text-xs px-2 py-1 rounded-full">
                      Selected
                    </span>
                  )}
                </div>
                <div className="space-y-1 text-sm">
                  <p className="text-gray-700">
                    {building.type === 'quarters' ? 'Houses' : 'Rooms'}: {buildingRooms.length}
                  </p>
                  <p className="text-gray-700">Capacity: {totalCapacity}</p>
                  <p className="text-gray-700">Occupied: {occupied}</p>
                  <div className="mt-2">
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-blue-600 h-2 rounded-full transition-all"
                        style={{ width: `${occupancyRate}%` }}
                      />
                    </div>
                    <p className="text-xs text-gray-600 mt-1">{occupancyRate}% occupied</p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Assign panel (trainers + visitors, bulk) */}
      {canManage && (
        <AssignPanel
          unassignedTrainers={unassignedTrainers}
          availableRooms={availableRooms}
          buildingFreeBeds={buildingFreeBeds}
          floorFreeBeds={floorFreeBeds}
          visitorAssignments={visitorAssignments}
          onChanged={() => router.invalidate()}
          onRemove={handleRemove}
          onRemoveGroup={handleRemoveGroup}
          isRemoving={isRemoving}
        />
      )}

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Filters</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <input
            type="text"
            placeholder={selectedBuilding === '' ? 'Select a building first...' : 'Search by occupant name...'}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
            disabled={selectedBuilding === ''}
          />

          <select
            value={selectedBuilding}
            onChange={(e) => handleBuildingChange(e.target.value as BuildingType | '')}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">Select a Building First</option>
            <optgroup label="Standard Dormitories">
              <option value="ANGGERIK">ANGGERIK</option>
              <option value="BOUGANVILLA">BOUGANVILLA</option>
              <option value="RAFLESIA">RAFLESIA</option>
            </optgroup>
            <optgroup label="VIP Dormitory">
              <option value="SEROJA">SEROJA (VIP)</option>
            </optgroup>
            <optgroup label="Quarters">
              <option value="LESTARI_4">LESTARI 4</option>
              <option value="LESTARI_5">LESTARI 5</option>
              <option value="LESTARI_6">LESTARI 6</option>
            </optgroup>
          </select>

          <select
            value={selectedFloor}
            onChange={(e) => setSelectedFloor(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
            disabled={selectedBuilding === ''}
          >
            <option value="all">{selectedBuilding === '' ? 'Select building first' : 'All Floors'}</option>
            {availableFloors.map((floor) => (
              <option key={floor.floorNumber} value={floor.floorNumber}>
                {floor.floorName}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Room Status - Grid Layout */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">
          {selectedBuilding !== ''
            ? `${selectedBuildingData?.displayName} - ${filteredRooms.length} ${selectedBuildingData?.type === 'quarters' ? 'houses' : 'rooms'}`
            : 'Room Layout - Please select a building'
          }
        </h2>

        {selectedBuilding === '' ? (
          <div className="text-center py-16 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
            <div className="text-6xl mb-4">🏢</div>
            <h3 className="text-xl font-semibold text-gray-700 mb-2">Select a Building to View Rooms</h3>
            <p className="text-gray-600 mb-4">Click on a building card above or use the dropdown filter to get started</p>
            <div className="flex justify-center gap-2 text-sm text-gray-500">
              <span>📍</span>
              <span>Available: {allBuildings.length} buildings • {allRooms.length} rooms</span>
            </div>
          </div>
        ) : filteredRooms.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">🔍</div>
            <p className="text-gray-600">No rooms found matching your filters</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredRooms.map(room => (
              <RoomCard
                key={room.id}
                room={room}
                onRemove={handleRemove}
                isRemoving={isRemoving}
                canManage={canManage}
              />
            ))}
          </div>
        )}
      </div>

      {/* Unassigned Trainers */}
      {unassignedTrainers.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">
            Unassigned Trainers ({unassignedTrainers.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {unassignedTrainers.map((trainer: any) => (
              <div
                key={trainer.id}
                className="p-4 border border-yellow-300 bg-yellow-50 rounded-lg"
              >
                <div className="flex items-center space-x-3">
                  <div className="w-12 h-12 bg-yellow-200 rounded-full flex items-center justify-center">
                    <span className="text-xl">⚠️</span>
                  </div>
                  <div>
                    <p className="font-semibold">{trainer.name}</p>
                    <p className="text-sm text-gray-600">{trainer.rank}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Assign panel: tabbed (Trainers / Visitors), with Rank + Department filters
// and bulk assignment.
// ---------------------------------------------------------------------------
function AssignPanel({
  unassignedTrainers,
  availableRooms,
  buildingFreeBeds,
  floorFreeBeds,
  visitorAssignments,
  onChanged,
  onRemove,
  onRemoveGroup,
  isRemoving,
}: {
  unassignedTrainers: any[]
  availableRooms: Array<{ id: string; label: string; free: number; capacity: number; vip: boolean }>
  buildingFreeBeds: Array<{ name: string; displayName: string; free: number }>
  floorFreeBeds: Array<{ building: string; buildingDisplayName: string; floor: number; floorName: string; free: number }>
  visitorAssignments: any[]
  onChanged: () => void | Promise<void>
  onRemove: (assignmentId: number) => void
  onRemoveGroup: (batchId: string) => void
  isRemoving: boolean
}) {
  const [tab, setTab] = useState<'trainers' | 'visitors' | 'mass'>('trainers')

  // Trainers tab state
  const [rankFilter, setRankFilter] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [trainerSearch, setTrainerSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [trainerTarget, setTrainerTarget] = useState('')
  const [isAssigning, setIsAssigning] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null)

  // Visitors tab state
  const emptyVisitor = { name: '', organization: '', phone: '', id_number: '', notes: '' }
  const [visitorForm, setVisitorForm] = useState(emptyVisitor)
  const [visitorRoom, setVisitorRoom] = useState('')
  const [isAddingVisitor, setIsAddingVisitor] = useState(false)

  // Mass visitors tab state
  const emptyMass = { organization: '', phone: '', notes: '', target: '', count: '' }
  const [massForm, setMassForm] = useState(emptyMass)
  const [isMassAssigning, setIsMassAssigning] = useState(false)

  // Visitor roster, split into individually-added guests and mass-checked-in groups
  const { visitorGroups, soloVisitors } = useMemo(() => {
    const groups = new Map<string, any[]>()
    const solo: any[] = []
    for (const a of visitorAssignments) {
      const batchId = a.visitor?.batch_id
      if (batchId) {
        const list = groups.get(batchId) || []
        list.push(a)
        groups.set(batchId, list)
      } else {
        solo.push(a)
      }
    }
    return {
      visitorGroups: [...groups.entries()].map(([batchId, rows]) => ({
        batchId,
        organization: rows[0]?.visitor?.organization || rows[0]?.visitor?.name || 'Visitors',
        count: rows.length,
        rooms: new Set(rows.map((r) => r.room_id)).size,
      })),
      soloVisitors: solo,
    }
  }, [visitorAssignments])

  const ranks = useMemo(
    () => [...new Set(unassignedTrainers.map((t) => t.rank).filter(Boolean))].sort(),
    [unassignedTrainers],
  )
  const departments = useMemo(
    () => [...new Set(unassignedTrainers.map((t) => t.department).filter(Boolean))].sort(),
    [unassignedTrainers],
  )

  const visibleTrainers = useMemo(() => {
    const q = trainerSearch.trim().toLowerCase()
    return unassignedTrainers.filter((t) =>
      (!rankFilter || t.rank === rankFilter) &&
      (!deptFilter || t.department === deptFilter) &&
      (!q || (t.name || '').toLowerCase().includes(q)),
    )
  }, [unassignedTrainers, rankFilter, deptFilter, trainerSearch])

  const toggleId = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      visibleTrainers.forEach((t) => next.add(t.id))
      return next
    })
  }

  const clearSelection = () => setSelectedIds(new Set())

  const handleBulkAssign = async () => {
    if (selectedIds.size === 0 || !trainerTarget) {
      setMessage({ kind: 'err', text: 'Pick at least one trainer and a destination.' })
      return
    }
    setIsAssigning(true)
    setMessage(null)
    try {
      const res: any = await assignTrainersBulk({
        data: { trainerIds: [...selectedIds], target: trainerTarget },
      })
      if (res?.error) {
        setMessage({ kind: 'err', text: res.error })
      } else {
        const parts = [`Assigned ${res.assigned} trainer(s).`]
        if (res.skipped) parts.push(`${res.skipped} already had a room.`)
        if (res.unplaced) parts.push(`${res.unplaced} could not fit — pick another destination.`)
        setMessage({ kind: res.unplaced ? 'warn' : 'ok', text: parts.join(' ') })
        clearSelection()
        setTrainerTarget('')
        await onChanged()
      }
    } catch (err) {
      setMessage({ kind: 'err', text: (err as Error).message })
    } finally {
      setIsAssigning(false)
    }
  }

  const handleAddVisitor = async () => {
    if (!visitorForm.name.trim() || !visitorRoom) {
      setMessage({ kind: 'err', text: 'Visitor name and a room are required.' })
      return
    }
    setIsAddingVisitor(true)
    setMessage(null)
    try {
      const res: any = await createAndAssignVisitor({
        data: { ...visitorForm, roomId: visitorRoom },
      })
      if (res?.error) {
        setMessage({ kind: 'err', text: res.error })
      } else {
        setMessage({ kind: 'ok', text: `Visitor "${visitorForm.name.trim()}" checked in.` })
        setVisitorForm(emptyVisitor)
        setVisitorRoom('')
        await onChanged()
      }
    } catch (err) {
      setMessage({ kind: 'err', text: (err as Error).message })
    } finally {
      setIsAddingVisitor(false)
    }
  }

  const handleMassAssign = async () => {
    if (!massForm.organization.trim() || !massForm.target) {
      setMessage({ kind: 'err', text: 'Organization and a destination are required.' })
      return
    }
    setIsMassAssigning(true)
    setMessage(null)
    try {
      const res: any = await massAssignVisitors({
        data: {
          organization: massForm.organization,
          phone: massForm.phone,
          notes: massForm.notes,
          target: massForm.target,
          count: massForm.count ? parseInt(massForm.count, 10) : 0,
        },
      })
      if (res?.error) {
        setMessage({ kind: 'err', text: res.error })
      } else {
        const parts = [
          `Checked in ${res.assigned} visitor(s) from ${massForm.organization.trim()} across ${res.roomsUsed} room(s).`,
        ]
        if (res.unplaced) parts.push(`${res.unplaced} could not be placed — target full.`)
        setMessage({ kind: res.unplaced ? 'warn' : 'ok', text: parts.join(' ') })
        setMassForm(emptyMass)
        await onChanged()
      }
    } catch (err) {
      setMessage({ kind: 'err', text: (err as Error).message })
    } finally {
      setIsMassAssigning(false)
    }
  }

  // Building + floor destinations, shared by the trainer and mass-visitor tabs
  const areaTargetOptions = (
    <>
      <optgroup label="Whole building">
        {buildingFreeBeds.map((b) => (
          <option key={b.name} value={`auto:${b.name}`} disabled={b.free === 0}>
            {b.displayName} — {b.free} bed(s) free
          </option>
        ))}
      </optgroup>
      {floorFreeBeds.length > 0 && (
        <optgroup label="Whole floor">
          {floorFreeBeds.map((f) => (
            <option
              key={`${f.building}:${f.floor}`}
              value={`floor:${f.building}:${f.floor}`}
              disabled={f.free === 0}
            >
              {f.buildingDisplayName} — {f.floorName} — {f.free} bed(s) free
            </option>
          ))}
        </optgroup>
      )}
    </>
  )

  const targetOptions = (
    <>
      <option value="">Select destination…</option>
      {areaTargetOptions}
      <optgroup label="Specific room">
        {availableRooms.map((r) => (
          <option key={r.id} value={`room:${r.id}`}>
            {r.label} ({r.free}/{r.capacity} free){r.vip ? ' — VIP' : ''}
          </option>
        ))}
      </optgroup>
    </>
  )

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center gap-2 mb-4 border-b">
        <button
          onClick={() => setTab('trainers')}
          className={`px-4 py-2 text-sm font-semibold -mb-px border-b-2 transition-colors ${
            tab === 'trainers'
              ? 'border-blue-600 text-blue-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Assign Trainers
        </button>
        <button
          onClick={() => setTab('visitors')}
          className={`px-4 py-2 text-sm font-semibold -mb-px border-b-2 transition-colors ${
            tab === 'visitors'
              ? 'border-blue-600 text-blue-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Temporary Visitors{visitorAssignments.length > 0 ? ` (${visitorAssignments.length})` : ''}
        </button>
        <button
          onClick={() => setTab('mass')}
          className={`px-4 py-2 text-sm font-semibold -mb-px border-b-2 transition-colors ${
            tab === 'mass'
              ? 'border-blue-600 text-blue-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Mass Assign Visitors
        </button>
      </div>

      {message && (
        <div
          className={`mb-4 rounded-lg border-2 p-3 text-sm ${
            message.kind === 'ok'
              ? 'bg-green-50 border-green-200 text-green-800'
              : message.kind === 'warn'
                ? 'bg-yellow-50 border-yellow-200 text-yellow-800'
                : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          {message.text}
        </div>
      )}

      {tab === 'trainers' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Rank</label>
              <select
                value={rankFilter}
                onChange={(e) => setRankFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">All ranks</option>
                {ranks.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
              <select
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">All departments</option>
                {departments.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Search name</label>
              <input
                type="text"
                value={trainerSearch}
                onChange={(e) => setTrainerSearch(e.target.value)}
                placeholder="Type a name…"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Selectable trainer list */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-gray-600">
                {visibleTrainers.length} unassigned trainer(s) match • {selectedIds.size} selected
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={selectAllVisible}
                  disabled={visibleTrainers.length === 0}
                  className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                >
                  Select all shown
                </button>
                <button
                  type="button"
                  onClick={clearSelection}
                  disabled={selectedIds.size === 0}
                  className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-lg divide-y">
              {visibleTrainers.length === 0 ? (
                <p className="p-4 text-sm text-gray-500 text-center">No trainers match these filters.</p>
              ) : (
                visibleTrainers.map((t) => (
                  <label
                    key={t.id}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-blue-50 cursor-pointer text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(t.id)}
                      onChange={() => toggleId(t.id)}
                      className="h-4 w-4"
                    />
                    <span className="font-medium text-gray-800">{t.name}</span>
                    <span className="text-gray-500">{t.rank}</span>
                    {t.department && (
                      <span className="ml-auto text-xs text-gray-400 truncate max-w-[45%]">{t.department}</span>
                    )}
                  </label>
                ))
              )}
            </div>
          </div>

          {/* Destination + assign */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div className="md:col-span-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">Destination</label>
              <select
                value={trainerTarget}
                onChange={(e) => setTrainerTarget(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {targetOptions}
              </select>
            </div>
            <button
              onClick={handleBulkAssign}
              disabled={isAssigning || selectedIds.size === 0 || !trainerTarget}
              className="w-full px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              {isAssigning ? 'Assigning…' : `Assign ${selectedIds.size || ''}`.trim()}
            </button>
          </div>
        </div>
      )}

      {tab === 'visitors' && (
        <div className="space-y-6">
          {/* Add visitor form */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Name <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                value={visitorForm.name}
                onChange={(e) => setVisitorForm({ ...visitorForm, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Organization</label>
              <input
                type="text"
                value={visitorForm.organization}
                onChange={(e) => setVisitorForm({ ...visitorForm, organization: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input
                type="text"
                value={visitorForm.phone}
                onChange={(e) => setVisitorForm({ ...visitorForm, phone: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ID / Passport No.</label>
              <input
                type="text"
                value={visitorForm.id_number}
                onChange={(e) => setVisitorForm({ ...visitorForm, id_number: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <input
                type="text"
                value={visitorForm.notes}
                onChange={(e) => setVisitorForm({ ...visitorForm, notes: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
              <div className="md:col-span-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">Room</label>
                <select
                  value={visitorRoom}
                  onChange={(e) => setVisitorRoom(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Select room…</option>
                  {availableRooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label} ({r.free}/{r.capacity} free){r.vip ? ' — VIP' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleAddVisitor}
                disabled={isAddingVisitor || !visitorForm.name.trim() || !visitorRoom}
                className="w-full px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              >
                {isAddingVisitor ? 'Adding…' : 'Check in'}
              </button>
            </div>
          </div>

          <CurrentVisitors
            soloVisitors={soloVisitors}
            visitorGroups={visitorGroups}
            total={visitorAssignments.length}
            onRemove={onRemove}
            onRemoveGroup={onRemoveGroup}
            isRemoving={isRemoving}
          />
        </div>
      )}

      {tab === 'mass' && (
        <div className="space-y-6">
          <p className="text-sm text-gray-600">
            Check a whole party of guests from one organization into a floor or a building at
            once. Only the organization name is required — one visitor record is created per bed.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Organization <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                value={massForm.organization}
                onChange={(e) => setMassForm({ ...massForm, organization: e.target.value })}
                placeholder="e.g. JBPM Ibu Pejabat"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Contact phone</label>
              <input
                type="text"
                value={massForm.phone}
                onChange={(e) => setMassForm({ ...massForm, phone: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <input
                type="text"
                value={massForm.notes}
                onChange={(e) => setMassForm({ ...massForm, notes: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Destination</label>
              <select
                value={massForm.target}
                onChange={(e) => setMassForm({ ...massForm, target: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">Select a floor or building…</option>
                {areaTargetOptions}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Number of visitors
              </label>
              <input
                type="number"
                min="1"
                value={massForm.count}
                onChange={(e) => setMassForm({ ...massForm, count: e.target.value })}
                placeholder="Leave blank to fill every free bed"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          <button
            onClick={handleMassAssign}
            disabled={isMassAssigning || !massForm.organization.trim() || !massForm.target}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            {isMassAssigning ? 'Assigning…' : 'Mass check in'}
          </button>

          <CurrentVisitors
            soloVisitors={soloVisitors}
            visitorGroups={visitorGroups}
            total={visitorAssignments.length}
            onRemove={onRemove}
            onRemoveGroup={onRemoveGroup}
            isRemoving={isRemoving}
          />
        </div>
      )}
    </div>
  )
}

// Roster of currently checked-in visitors: mass-assigned parties collapse to one
// row with a group check-out; individually added guests keep a per-person row.
function CurrentVisitors({
  soloVisitors,
  visitorGroups,
  total,
  onRemove,
  onRemoveGroup,
  isRemoving,
}: {
  soloVisitors: any[]
  visitorGroups: Array<{ batchId: string; organization: string; count: number; rooms: number }>
  total: number
  onRemove: (assignmentId: number) => void
  onRemoveGroup: (batchId: string) => void
  isRemoving: boolean
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-700 mb-2">Current visitors ({total})</h3>
      {total === 0 ? (
        <p className="text-sm text-gray-500">No temporary visitors are checked in.</p>
      ) : (
        <div className="border border-gray-200 rounded-lg divide-y">
          {visitorGroups.map((g) => (
            <div key={g.batchId} className="flex items-center gap-3 px-3 py-2 text-sm bg-purple-50">
              <span className="font-medium text-gray-800">{g.organization}</span>
              <span className="text-gray-500">
                {g.count} visitor(s) · {g.rooms} room(s)
              </span>
              <button
                onClick={() => onRemoveGroup(g.batchId)}
                disabled={isRemoving}
                className="ml-auto text-xs px-2 py-1 border border-red-300 text-red-700 rounded hover:bg-red-50 disabled:opacity-50"
              >
                Check out all ({g.count})
              </button>
            </div>
          ))}
          {soloVisitors.map((a: any) => (
            <div key={a.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="font-medium text-gray-800">{a.visitor.name}</span>
              {a.visitor.organization && (
                <span className="text-gray-500">{a.visitor.organization}</span>
              )}
              <span className="text-gray-400">{a.room_id}</span>
              <button
                onClick={() => onRemove(a.id)}
                disabled={isRemoving}
                className="ml-auto text-xs px-2 py-1 border border-red-300 text-red-700 rounded hover:bg-red-50 disabled:opacity-50"
              >
                Check out
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Stat Card Component
function StatCard({ title, value, icon, color }: {
  title: string;
  value: string | number;
  icon: string;
  color: string;
}) {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-600 mb-1">{title}</p>
          <p className="text-3xl font-bold">{value}</p>
        </div>
        <div className={`${color} w-16 h-16 rounded-full flex items-center justify-center text-3xl`}>
          {icon}
        </div>
      </div>
    </div>
  )
}

// Room Card Component
function RoomCard({ room, onRemove, isRemoving, canManage }: {
  room: any;
  onRemove: (assignmentId: number) => void;
  isRemoving: boolean;
  canManage: boolean;
}) {
  const { roomNumber, capacity, assignments, buildingDisplayName, buildingColor, floorName, type } = room
  const currentOccupancy = assignments.length
  const occupancyText = `${currentOccupancy}/${capacity}`

  // Create bed/occupant slots
  const slots = Array.from({ length: capacity }, (_, index) => {
    const assignment = assignments[index]
    return {
      slotNumber: index + 1,
      assignment: assignment || null,
      occupied: !!assignment
    }
  })

  // Determine grid layout based on capacity
  let gridCols = 'grid-cols-2'
  if (capacity === 1) gridCols = 'grid-cols-1'
  if (capacity === 8) gridCols = 'grid-cols-4'

  const roomLabel = type === 'quarters'
    ? `House ${roomNumber}`
    : `Room ${roomNumber}`

  return (
    <div className={`border-2 ${buildingColor} rounded-lg p-4 hover:shadow-md transition-shadow`}>
      {/* Room Header */}
      <div className="mb-3 border-b pb-2">
        <h3 className="text-base font-bold text-gray-900">{buildingDisplayName}</h3>
        <p className="text-sm text-gray-700">{floorName} - {roomLabel}</p>
        <p className="text-xs text-gray-600">
          {occupancyText} {type === 'vip' ? '(VIP)' : type === 'quarters' ? '(Quarters)' : ''}
        </p>
      </div>

      {/* Bed/Occupant Grid */}
      <div className={`grid ${gridCols} gap-2 mb-3`}>
        {slots.map((slot) => (
          <OccupantSlot
            key={slot.slotNumber}
            slotNumber={slot.slotNumber}
            assignment={slot.assignment}
            occupied={slot.occupied}
            onRemove={onRemove}
            isRemoving={isRemoving}
            isQuarters={type === 'quarters'}
            canManage={canManage}
          />
        ))}
      </div>
    </div>
  )
}

// Individual Occupant Slot Component
function OccupantSlot({ slotNumber, assignment, occupied, onRemove, isRemoving, canManage }: {
  slotNumber: number;
  assignment: any;
  occupied: boolean;
  onRemove: (assignmentId: number) => void;
  isRemoving: boolean;
  isQuarters: boolean;
  canManage: boolean;
}) {
  const occupant = occupantOf(assignment)

  if (occupied && occupant && assignment) {
    const isVisitor = occupant.kind === 'visitor'
    const palette = isVisitor
      ? 'bg-purple-100 border-purple-300 hover:bg-purple-200'
      : 'bg-red-100 border-red-300 hover:bg-red-200'
    return (
      <div className={`${palette} border rounded p-2 min-h-[60px] flex flex-col items-center justify-center transition-colors relative group`}>
        {isVisitor && (
          <span className="absolute top-0 left-0 -mt-1 -ml-1 bg-purple-600 text-white text-[9px] px-1 rounded">
            Visitor
          </span>
        )}
        <p className="text-xs font-semibold text-gray-800 text-center leading-tight break-words">
          {occupant.name}
        </p>
        <p className="text-xs text-gray-600 mt-1">{occupant.sub}</p>

        {canManage && (
          <button
            onClick={() => onRemove(assignment.id)}
            disabled={isRemoving}
            className="absolute top-0 right-0 -mt-1 -mr-1 bg-red-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            title="Remove occupant"
          >
            ×
          </button>
        )}
      </div>
    )
  }

  // Vacant slot - blue background
  return (
    <div className="bg-blue-50 border border-blue-200 rounded p-2 min-h-[60px] flex flex-col items-center justify-center transition-colors hover:bg-blue-100">
      <span className="text-gray-400 text-2xl font-light">—</span>
      <p className="text-xs text-gray-500 mt-1">Bed {slotNumber}</p>
    </div>
  )
}
