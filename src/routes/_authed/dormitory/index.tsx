import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from '~/utils/supabase'
import { useState } from 'react'

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

  // Calculate statistics
  const totalRooms = 50 // Configure based on actual rooms
  const occupiedRooms = new Set(assignments?.map(a => a.room_id)).size
  const totalCapacity = totalRooms * 6 // 6 beds per room
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

export const Route = createFileRoute('/_authed/dormitory/')({
  loader: async () => await getDormitoryData(),
  component: DormitoryPage,
})

function DormitoryPage() {
  const { assignments, trainers, stats } = Route.useLoaderData()
  const [selectedBuilding, setSelectedBuilding] = useState<string>('all')
  const [selectedFloor, setSelectedFloor] = useState<string>('all')
  const [searchTerm, setSearchTerm] = useState('')

  // Group assignments by room
  const roomAssignments = assignments.reduce((acc: any, assignment: any) => {
    const roomId = assignment.room_id
    if (!acc[roomId]) {
      acc[roomId] = []
    }
    acc[roomId].push(assignment)
    return acc
  }, {})

  // Generate all possible rooms
  const generateAllRooms = () => {
    const rooms = []
    const blocks = ['A', 'B', 'C']
    const roomsPerBlock = 5
    
    for (const block of blocks) {
      for (let roomNum = 1; roomNum <= roomsPerBlock; roomNum++) {
        const roomId = `Block ${block} - Room ${roomNum}`
        rooms.push({
          id: roomId,
          block,
          roomNumber: roomNum,
          capacity: 6, // 6 beds per room
          assignments: roomAssignments[roomId] || []
        })
      }
    }
    
    return rooms
  }

  const allRooms = generateAllRooms()

  // Filter rooms
  const filteredRooms = allRooms.filter(room => {
    const matchesBuilding = selectedBuilding === 'all' || room.block === selectedBuilding
    
    if (!matchesBuilding) return false
    
    if (searchTerm) {
      return room.assignments.some((a: any) => 
        a.trainer?.name.toLowerCase().includes(searchTerm.toLowerCase())
      )
    }
    
    return true
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow p-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Dormitory Management</h1>
        <p className="text-gray-600">Track room assignments and occupancy</p>
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

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Search */}
          <input
            type="text"
            placeholder="Search by trainer name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />

          {/* Building Filter */}
          <select
            value={selectedBuilding}
            onChange={(e) => setSelectedBuilding(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="all">All Buildings</option>
            <option value="A">Block A</option>
            <option value="B">Block B</option>
            <option value="C">Block C</option>
          </select>

          {/* Floor Filter - Keeping for future use */}
          <select
            value={selectedFloor}
            onChange={(e) => setSelectedFloor(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="all">All Floors</option>
            <option value="1">Floor 1</option>
            <option value="2">Floor 2</option>
            <option value="3">Floor 3</option>
          </select>
        </div>
      </div>

      {/* Dormitory Status - Grid Layout */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">
          Dormitory Status ({filteredRooms.length} rooms)
        </h2>
        
        {filteredRooms.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">🏢</div>
            <p className="text-gray-600">No rooms found matching your filters</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {filteredRooms.map(room => (
              <RoomCardWithGrid 
                key={room.id} 
                room={room}
              />
            ))}
          </div>
        )}
      </div>

      {/* Unassigned Trainers */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Unassigned Trainers</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {trainers
            .filter((trainer: any) => 
              !assignments.some((a: any) => a.trainer?.id === trainer.id)
            )
            .map((trainer: any) => (
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
          
          {trainers.filter((t: any) => 
            !assignments.some((a: any) => a.trainer?.id === t.id)
          ).length === 0 && (
            <p className="text-gray-600 col-span-full">All trainers are assigned to rooms</p>
          )}
        </div>
      </div>
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

// Room Card with Grid Layout
function RoomCardWithGrid({ room }: { room: any }) {
  const { id, block, roomNumber, capacity, assignments } = room
  const currentOccupancy = assignments.length
  const occupancyText = `${currentOccupancy}/${capacity}`
  
  // Create an array of bed slots (6 beds arranged in 3x2 grid)
  const bedSlots = Array.from({ length: capacity }, (_, index) => {
    const assignment = assignments[index]
    return {
      bedNumber: index + 1,
      trainer: assignment?.trainer || null,
      occupied: !!assignment
    }
  })

  return (
    <div className="border-2 border-gray-200 rounded-lg p-4 bg-white hover:shadow-md transition-shadow">
      {/* Room Header */}
      <div className="mb-3">
        <h3 className="text-base font-bold text-gray-900">{id}</h3>
        <p className="text-xs text-gray-600">{occupancyText} Training Complex {block}</p>
      </div>

      {/* Bed Grid - 3 columns x 2 rows = 6 beds */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        {bedSlots.map((slot) => (
          <BedSlot 
            key={slot.bedNumber}
            bedNumber={slot.bedNumber}
            trainer={slot.trainer}
            occupied={slot.occupied}
          />
        ))}
      </div>

      {/* Facilities Info */}
      <div className="text-xs text-gray-500 border-t pt-2">
        <p>Facilities: Air Conditioning, WiFi, Study Table</p>
      </div>
    </div>
  )
}

// Individual Bed Slot Component
function BedSlot({ bedNumber, trainer, occupied }: { 
  bedNumber: number; 
  trainer: any; 
  occupied: boolean;
}) {
  if (occupied && trainer) {
    // Occupied slot - light red/pink background with trainer name
    return (
      <div className="bg-red-100 border border-red-300 rounded p-2 min-h-[50px] flex flex-col items-center justify-center transition-colors hover:bg-red-200">
        <p className="text-xs font-semibold text-gray-800 text-center leading-tight break-words">
          {trainer.name}
        </p>
      </div>
    )
  }
  
  // Vacant slot - light blue background with dash
  return (
    <div className="bg-blue-50 border border-blue-200 rounded p-2 min-h-[50px] flex items-center justify-center transition-colors hover:bg-blue-100">
      <span className="text-gray-400 text-lg font-light">—</span>
    </div>
  )
}