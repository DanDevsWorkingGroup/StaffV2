import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from '~/utils/supabase'
import { resolveUserRole, checkRole, canAccessOverviewClient } from '~/middleware/rbac'

// Server function to fetch trainer profile
const getTrainerProfile = createServerFn({ method: 'GET' })
  .inputValidator((data: { trainerId: string }) => data)
  .handler(async ({ data }) => {
    // Only ADMIN/COORDINATOR may view a trainer's profile (matches the directory guard).
    checkRole(await resolveUserRole(), ['ADMIN', 'COORDINATOR'])

    const supabase = getSupabaseServerClient()
    
    const trainerId = parseInt(data.trainerId)
    
    // Get trainer data
    const { data: trainer, error: trainerError } = await supabase
      .from('trainers')
      .select('*')
      .eq('id', trainerId)
      .single()

    if (trainerError || !trainer) {
      throw new Error('Trainer not found')
    }

    // Get email from auth.users if user_id exists
    let email = ''
    if (trainer.user_id) {
      const { data: authUser } = await supabase.auth.admin.getUserById(trainer.user_id)
      email = authUser?.user?.email || ''
    }

    // Get role data
    let roleData = null
    if (trainer.role_id) {
      const { data: role } = await supabase
        .from('roles')
        .select('id, name, level, description')
        .eq('id', trainer.role_id)
        .single()
      
      roleData = role
    }

    // Get activity statistics
    const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString().split('T')[0]

    const { data: religiousActivities } = await supabase
      .from('religious_activities')
      .select('id')
      .contains('participants', [trainer.id])

    const { data: physicalTraining } = await supabase
      .from('physical_training')
      .select('id')
      .contains('participants', [trainer.id])

    const { data: events } = await supabase
      .from('events')
      .select('id')
      .contains('trainer_ids', [trainer.id])

    const { data: monthlyReligious } = await supabase
      .from('religious_activities')
      .select('id')
      .contains('participants', [trainer.id])
      .gte('date', firstDayOfMonth)

    const { data: monthlyPT } = await supabase
      .from('physical_training')
      .select('id')
      .contains('participants', [trainer.id])
      .gte('date', firstDayOfMonth)

    const activityStats = {
      totalReligious: religiousActivities?.length || 0,
      totalPhysicalTraining: physicalTraining?.length || 0,
      totalEvents: events?.length || 0,
      monthlyReligious: monthlyReligious?.length || 0,
      monthlyPhysicalTraining: monthlyPT?.length || 0,
    }

    return {
      profile: {
        id: trainer.id,
        name: trainer.name,
        email: email,
        role: roleData?.name || 'TRAINER',
        roleLevel: roleData?.level || 0,
        roleDescription: roleData?.description || '',
        rank: trainer.rank || 'Not set',
        region: trainer.region || 'Not set',
        specialization: trainer.specialization || 'Not set',
        department: trainer.department || 'Not set',
        status: trainer.status,
        isActive: trainer.is_active,
        createdAt: trainer.created_at,
        updatedAt: trainer.updated_at,
        lastLogin: trainer.last_login || null,
      },
      activityStats,
    }
  })

export const Route = createFileRoute('/_authed/trainer-overview/$id')({
  beforeLoad: ({ context }) => {
    if (!context.user?.role || !canAccessOverviewClient(context.user.role)) {
      throw new Error('Unauthorized Access: you do not have permission to view trainer profiles')
    }
  },
  loader: async ({ params }) => await getTrainerProfile({ data: { trainerId: params.id } }),
  component: TrainerProfilePage,
})

function TrainerProfilePage() {
  const { profile, activityStats } = Route.useLoaderData()

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Back Button */}
      <Link
        to="/trainer-overview"
        className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-800 font-semibold"
      >
        ← Back to Trainer Directory
      </Link>

      {/* Header Section */}
      <div className="bg-gradient-to-r from-orange-600 to-red-700 rounded-lg shadow-lg p-8 text-white">
        <div className="flex items-center space-x-6">
          <div className="w-24 h-24 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center border-4 border-white/30">
            <span className="text-5xl font-bold text-white">
              {profile.name?.charAt(0).toUpperCase() || 'T'}
            </span>
          </div>
          
          <div className="flex-1">
            <h1 className="text-3xl font-bold mb-2">
              {profile.name}
            </h1>
            {profile.email && (
              <p className="text-orange-100 text-lg">{profile.email}</p>
            )}
            <div className="flex items-center space-x-4 mt-3">
              <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
                profile.isActive 
                  ? 'bg-green-500/30 text-green-100 border border-green-300/50' 
                  : 'bg-gray-500/30 text-gray-100 border border-gray-300/50'
              }`}>
                {profile.isActive ? '✓ Active' : 'Inactive'}
              </span>
              <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
                profile.role === 'ADMIN' 
                  ? 'bg-purple-500/30 text-purple-100 border border-purple-300/50'
                  : profile.role === 'COORDINATOR'
                  ? 'bg-blue-500/30 text-blue-100 border border-blue-300/50'
                  : 'bg-green-500/30 text-green-100 border border-green-300/50'
              }`}>
                {profile.role === 'ADMIN' ? '👑 Administrator' : 
                 profile.role === 'COORDINATOR' ? '📋 Coordinator' : 
                 '👨‍🏫 Trainer'}
              </span>
            </div>
          </div>

          {/* Edit Button */}
          <Link
            to="/trainer-overview/edit/$id"
            params={{ id: profile.id.toString() }}
            className="px-6 py-3 bg-white text-orange-600 rounded-lg font-semibold hover:bg-orange-50 transition"
          >
            ✏️ Edit Profile
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Personal Information */}
        <div className="lg:col-span-2 space-y-6">
          {/* Personal Details Card */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center">
              <span className="text-3xl mr-3">👤</span>
              Personal Information
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <InfoField label="Full Name" value={profile.name} />
              {profile.email && (
                <InfoField label="Email Address" value={profile.email} />
              )}
              <InfoField label="Role" value={profile.role} />
              <InfoField label="Rank" value={profile.rank} />
              <InfoField label="Region" value={profile.region} />
              <InfoField label="Specialization" value={profile.specialization} />
              <InfoField label="Department" value={profile.department} highlight={true} />
              <InfoField label="Status" value={profile.status} />
              <InfoField 
                label="Account Created" 
                value={new Date(profile.createdAt).toLocaleDateString('en-MY', { 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric' 
                })} 
              />
              <InfoField 
                label="Last Updated" 
                value={new Date(profile.updatedAt).toLocaleDateString('en-MY', { 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric' 
                })} 
              />
            </div>
          </div>

          {/* Role Permissions Card */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center">
              <span className="text-3xl mr-3">🔐</span>
              Role & Permissions
            </h2>
            
            <div className="space-y-4">
              <div className="p-4 bg-blue-50 rounded-lg border-2 border-blue-200">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-lg text-gray-900">{profile.role}</h3>
                  <span className="px-3 py-1 bg-blue-600 text-white rounded-full text-sm font-semibold">
                    Level {profile.roleLevel}
                  </span>
                </div>
                <p className="text-sm text-gray-700">
                  {profile.roleDescription}
                </p>
              </div>
              
              {profile.role === 'ADMIN' && (
                <div className="p-4 bg-purple-50 rounded-lg border border-purple-200">
                  <p className="text-sm text-purple-900 font-medium">
                    ✓ Full system access • User management • All modules
                  </p>
                </div>
              )}
              
              {profile.role === 'COORDINATOR' && (
                <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <p className="text-sm text-blue-900 font-medium">
                    ✓ Schedule management • Event creation • Trainer assignments
                  </p>
                </div>
              )}
              
              {profile.role === 'TRAINER' && (
                <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                  <p className="text-sm text-green-900 font-medium">
                    ✓ View schedules • Update profile • View activities
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column - Activity Stats */}
        <div className="space-y-6">
          {activityStats && (
            <>
              {/* Quick Stats Card */}
              <div className="bg-white rounded-lg shadow-lg p-6">
                <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center">
                  <span className="text-2xl mr-2">📊</span>
                  Activity Overview
                </h2>
                
                <div className="space-y-3">
                  <StatItem 
                    icon="📖" 
                    label="Religious Activities" 
                    count={activityStats.totalReligious}
                    color="bg-green-100 text-green-800"
                  />
                  <StatItem 
                    icon="💪" 
                    label="Physical Training" 
                    count={activityStats.totalPhysicalTraining}
                    color="bg-orange-100 text-orange-800"
                  />
                  <StatItem 
                    icon="📅" 
                    label="Events Assigned" 
                    count={activityStats.totalEvents}
                    color="bg-blue-100 text-blue-800"
                  />
                </div>
              </div>

              {/* Monthly Stats Card */}
              <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg shadow-lg p-6 text-white">
                <h2 className="text-xl font-bold mb-4 flex items-center">
                  <span className="text-2xl mr-2">📅</span>
                  This Month
                </h2>
                
                <div className="space-y-3">
                  <div className="flex justify-between items-center py-2 border-b border-white/20">
                    <span className="text-blue-100">Religious Activities</span>
                    <span className="text-2xl font-bold">{activityStats.monthlyReligious}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-white/20">
                    <span className="text-blue-100">PT Sessions</span>
                    <span className="text-2xl font-bold">{activityStats.monthlyPhysicalTraining}</span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-blue-100">Total Activities</span>
                    <span className="text-2xl font-bold">
                      {activityStats.monthlyReligious + activityStats.monthlyPhysicalTraining}
                    </span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// Helper Components
function InfoField({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-gray-600 mb-1">{label}</label>
      <p className={`text-base font-medium text-gray-900 px-4 py-2 rounded-lg border ${
        highlight 
          ? 'bg-yellow-50 border-yellow-300' 
          : 'bg-gray-50 border-gray-200'
      }`}>
        {value}
      </p>
    </div>
  )
}

function StatItem({ icon, label, count, color }: { icon: string; label: string; count: number; color: string }) {
  return (
    <div className={`flex items-center justify-between p-3 rounded-lg ${color}`}>
      <div className="flex items-center space-x-2">
        <span className="text-xl">{icon}</span>
        <span className="font-semibold">{label}</span>
      </div>
      <span className="text-2xl font-bold">{count}</span>
    </div>
  )
}