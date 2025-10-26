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
  const totalCapacity = totalRooms * 4 // 4 people per room
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

  // Filter rooms
  const filteredRooms = Object.keys(roomAssignments).filter(roomId => {
    const building = roomId.split('-')[0]
    const floor = roomId.split('-')[1]
    
    const matchesBuilding = selectedBuilding === 'all' || building === selectedBuilding
    const matchesFloor = selectedFloor === 'all' || floor === selectedFloor
    
    if (!matchesBuilding || !matchesFloor) return false
    
    if (searchTerm) {
      const roomTrainers = roomAssignments[roomId]
      return roomTrainers.some((a: any) => 
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
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Search */}
          <div className="md:col-span-2">
            <input
              type="text"
              placeholder="Search by trainer name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Building Filter */}
          <select
            value={selectedBuilding}
            onChange={(e) => setSelectedBuilding(e.target.value)}
            className="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Buildings</option>
            <option value="A">Building A</option>
            <option value="B">Building B</option>
            <option value="C">Building C</option>
          </select>

          {/* Floor Filter */}
          <select
            value={selectedFloor}
            onChange={(e) => setSelectedFloor(e.target.value)}
            className="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Floors</option>
            <option value="1">Floor 1</option>
            <option value="2">Floor 2</option>
            <option value="3">Floor 3</option>
            <option value="4">Floor 4</option>
          </select>
        </div>
      </div>

      {/* Room Grid */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">
          Room Assignments ({filteredRooms.length} rooms)
        </h2>
        
        {filteredRooms.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">🏢</div>
            <p className="text-gray-600">No rooms found matching your filters</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredRooms.map(roomId => (
              <RoomCard 
                key={roomId} 
                roomId={roomId} 
                assignments={roomAssignments[roomId]} 
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

// Room Card Component
function RoomCard({ roomId, assignments }: { roomId: string; assignments: any[] }) {
  const capacity = 4
  const currentOccupancy = assignments.length
  const occupancyPercentage = (currentOccupancy / capacity) * 100
  
  const getStatusColor = () => {
    if (currentOccupancy === 0) return 'border-gray-300 bg-gray-50'
    if (currentOccupancy === capacity) return 'border-red-300 bg-red-50'
    return 'border-green-300 bg-green-50'
  }

  const getStatusBadge = () => {
    if (currentOccupancy === 0) return { text: 'Empty', color: 'bg-gray-500' }
    if (currentOccupancy === capacity) return { text: 'Full', color: 'bg-red-500' }
    return { text: 'Available', color: 'bg-green-500' }
  }

  const status = getStatusBadge()

  return (
    <div className={`border-2 rounded-lg p-4 ${getStatusColor()}`}>
      {/* Room Header */}
      <div className="flex justify-between items-start mb-3">
        <div>
          <h3 className="text-lg font-bold text-gray-900">{roomId}</h3>
          <p className="text-sm text-gray-600">Capacity: {currentOccupancy}/{capacity}</p>
        </div>
        <span className={`${status.color} text-white text-xs px-2 py-1 rounded font-semibold`}>
          {status.text}
        </span>
      </div>

      {/* Occupancy Bar */}
      <div className="mb-3">
        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
          <div 
            className="h-full bg-blue-600 transition-all"
            style={{ width: `${occupancyPercentage}%` }}
          />
        </div>
      </div>

      {/* Assigned Trainers */}
      <div className="space-y-2">
        {assignments.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No trainers assigned</p>
        ) : (
          assignments.map((assignment: any) => (
            <div 
              key={assignment.id} 
              className="flex items-center space-x-2 text-sm bg-white p-2 rounded"
            >
              <span className="text-lg">👤</span>
              <div className="flex-1">
                <p className="font-medium">{assignment.trainer?.name}</p>
                <p className="text-xs text-gray-600">{assignment.trainer?.rank}</p>
              </div>
            </div>
          ))
        )}
        
        {/* Empty Slots */}
        {Array.from({ length: capacity - currentOccupancy }).map((_, idx) => (
          <div 
            key={`empty-${idx}`} 
            className="flex items-center space-x-2 text-sm bg-white border border-dashed border-gray-300 p-2 rounded"
          >
            <span className="text-lg">➕</span>
            <p className="text-gray-500 italic">Available slot</p>
          </div>
        ))}
      </div>
    </div>
  )
}