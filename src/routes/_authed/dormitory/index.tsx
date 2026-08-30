import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from '~/utils/supabase'
import { resolveUserRole, checkRole } from '~/middleware/rbac'
import { useState } from 'react'
import { useCanManageDormitory } from '~/hooks/useRBAC'  // ADD THIS

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

// Server function to fetch dormitory data
const getDormitoryData = createServerFn({ method: 'GET' }).handler(async () => {
  const supabase = getSupabaseServerClient()

  const { data: assignments } = await supabase
    .from('dormitory_assignments')
    .select(`
      *,
      trainer:trainers(id, name, rank)
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

// Server function to assign trainer to room
const assignTrainer = createServerFn({ method: 'POST' })
  .inputValidator((data: { trainerId: number; roomId: string }) => data)
  .handler(async ({ data }) => {
    checkRole(await resolveUserRole(), ['ADMIN', 'COORDINATOR', 'DORMITORY COORDINATOR'])

    const supabase = getSupabaseServerClient()

    const { error } = await supabase
      .from('dormitory_assignments')
      .insert({
        trainer_id: data.trainerId,
        room_id: data.roomId,
        check_in: new Date().toISOString(),
        status: 'active'
      })

    if (error) {
      throw new Error(error.message)
    }

    return { success: true }
  })

// Server function to remove trainer from room
const removeTrainer = createServerFn({ method: 'POST' })
  .inputValidator((data: { assignmentId: number }) => data)
  .handler(async ({ data }) => {
    checkRole(await resolveUserRole(), ['ADMIN', 'COORDINATOR', 'DORMITORY COORDINATOR'])

    const supabase = getSupabaseServerClient()

    const { error } = await supabase
      .from('dormitory_assignments')
      .delete()
      .eq('id', data.assignmentId)

    if (error) {
      throw new Error(error.message)
    }

    return { success: true }
  })

export const Route = createFileRoute('/_authed/dormitory/')({
  beforeLoad: ({ context }) => {
  // UPDATED: Only allow ADMIN, COORDINATOR, DORMITORY COORDINATOR
  const allowedRoles = ['ADMIN', 'COORDINATOR', 'DORMITORY COORDINATOR']
  
  if (!context.user?.role || !allowedRoles.includes(context.user.role)) {
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

function DormitoryPage() {
  const router = useRouter()
  const { assignments, trainers, stats } = Route.useLoaderData()
  const [selectedBuilding, setSelectedBuilding] = useState<BuildingType | ''>('')
  const [selectedFloor, setSelectedFloor] = useState<number | 'all'>('all')
  const [searchTerm, setSearchTerm] = useState('')

  const data = Route.useLoaderData()
  // ADD THIS LINE:
  const canManage = useCanManageDormitory()  // Check if user can manage

  // Assignment form state
  const [selectedTrainer, setSelectedTrainer] = useState<string>('')
  const [selectedRoom, setSelectedRoom] = useState<string>('')
  const [isAssigning, setIsAssigning] = useState(false)
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
        return room.assignments.some((a: any) =>
          a.trainer?.name.toLowerCase().includes(searchTerm.toLowerCase())
        )
      }

      return true
    })

  // Get unassigned trainers
  const unassignedTrainers = trainers.filter((trainer: any) =>
    !assignments.some((a: any) => a.trainer?.id === trainer.id)
  )

  // Handle assign trainer
  const handleAssign = async () => {
    if (!selectedTrainer || !selectedRoom) {
      alert('Please select both a trainer and a room')
      return
    }

    setIsAssigning(true)
    try {
      await assignTrainer({
        data: {
          trainerId: parseInt(selectedTrainer),
          roomId: selectedRoom
        }
      })

      // Reset form
      setSelectedTrainer('')
      setSelectedRoom('')

      // Invalidate and refetch data
      await router.invalidate()
    } catch (error) {
      alert('Failed to assign trainer: ' + (error as Error).message)
    } finally {
      setIsAssigning(false)
    }
  }

  // Handle remove trainer
  const handleRemove = async (assignmentId: number) => {
    if (!confirm('Are you sure you want to remove this trainer from the room?')) {
      return
    }

    setIsRemoving(true)
    try {
      await removeTrainer({ data: { assignmentId } })

      // Invalidate and refetch data
      await router.invalidate()
    } catch (error) {
      alert('Failed to remove trainer: ' + (error as Error).message)
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

      {/* Assign Trainer to Dormitory */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Assign Trainer to Dormitory</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          {/* Trainer Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select Trainer
            </label>
            <select
              value={selectedTrainer}
              onChange={(e) => setSelectedTrainer(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={isAssigning || isRemoving}
            >
              <option value="">Select Trainer</option>
              {unassignedTrainers.map((trainer: any) => (
                <option key={trainer.id} value={trainer.id}>
                  {trainer.name} - {trainer.rank}
                </option>
              ))}
            </select>
          </div>

          {/* Room Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select Room/House
            </label>
            <select
              value={selectedRoom}
              onChange={(e) => setSelectedRoom(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={isAssigning || isRemoving}
            >
              <option value="">Select Room</option>
              {allRooms
                .filter(room => room.assignments.length < room.capacity)
                .map((room) => {
                  const roomLabel = room.type === 'quarters'
                    ? `${room.buildingDisplayName} - House ${room.roomNumber}`
                    : `${room.buildingDisplayName} - ${room.floorName} - Room ${room.roomNumber}`

                  return (
                    <option key={room.id} value={room.id}>
                      {roomLabel} ({room.assignments.length}/{room.capacity})
                      {room.type === 'vip' ? ' - VIP' : ''}
                    </option>
                  )
                })}
            </select>
          </div>

          {/* Assign Button */}
          <div>
            <button
              onClick={handleAssign}
              disabled={isAssigning || isRemoving || !selectedTrainer || !selectedRoom}
              className="w-full px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              {isAssigning ? 'Assigning...' : 'Assign'}
            </button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Filters</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <input
            type="text"
            placeholder={selectedBuilding === '' ? 'Select a building first...' : 'Search by trainer name...'}
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
                canManage={canManage}  // ADD THIS
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
   canManage: boolean;  // ADD THIS TYPE
}) {
  const { id, roomNumber, capacity, assignments, buildingDisplayName, buildingColor, floorName, type } = room
  const currentOccupancy = assignments.length
  const occupancyText = `${currentOccupancy}/${capacity}`

  // Create bed/occupant slots
  const slots = Array.from({ length: capacity }, (_, index) => {
    const assignment = assignments[index]
    return {
      slotNumber: index + 1,
      assignment: assignment || null,
      trainer: assignment?.trainer || null,
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
            trainer={slot.trainer}
            assignment={slot.assignment}
            occupied={slot.occupied}
            onRemove={onRemove}
            isRemoving={isRemoving}
            isQuarters={type === 'quarters'}
            canManage={canManage}  // ADD THIS
          />
        ))}
      </div>
    </div>
  )
}

// Individual Occupant Slot Component
function OccupantSlot({ slotNumber, trainer, assignment, occupied, onRemove, isRemoving, isQuarters,canManage}: {
  slotNumber: number;
  trainer: any;
  assignment: any;
  occupied: boolean;
  onRemove: (assignmentId: number) => void;
  isRemoving: boolean;
  isQuarters: boolean;
  canManage: boolean; 
}) {
  if (occupied && trainer && assignment) {
    // Occupied slot - red background with trainer name
    return (
      <div className="bg-red-100 border border-red-300 rounded p-2 min-h-[60px] flex flex-col items-center justify-center transition-colors hover:bg-red-200 relative group">
        <p className="text-xs font-semibold text-gray-800 text-center leading-tight break-words">
          {trainer.name}
        </p>
        <p className="text-xs text-gray-600 mt-1">{trainer.rank}</p>

          {/* UPDATED: Only show remove button if canManage */}
        {canManage && (  // ADD THIS CONDITION
        <button
          onClick={() => onRemove(assignment.id)}
          disabled={isRemoving}
          className="absolute top-0 right-0 -mt-1 -mr-1 bg-red-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          title="Remove trainer"
        >
          ×
        </button>
        )}  {/* ADD THIS CLOSING BRACE */}
      </div>
    )
  }

  // Vacant slot - blue background
  return (
    <div className="bg-blue-50 border border-blue-200 rounded p-2 min-h-[60px] flex flex-col items-center justify-center transition-colors hover:bg-blue-100">
      <span className="text-gray-400 text-2xl font-light">—</span>
      <p className="text-xs text-gray-500 mt-1">
        {isQuarters ? `Bed ${slotNumber}` : `Bed ${slotNumber}`}
      </p>
    </div>
  )
}