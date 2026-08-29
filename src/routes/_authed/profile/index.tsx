import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from '~/utils/supabase'

// Server function to fetch user profile
const getUserProfile = createServerFn({ method: 'GET' }).handler(async () => {
  const supabase = getSupabaseServerClient()
  
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  
  if (authError || !user) {
    throw new Error('Not authenticated')
  }

  // METHOD 1: Use raw SQL query (most reliable)
  const { data: profileData, error: profileError } = await supabase.rpc('get_trainer_profile', {
    p_user_id: user.id
  })

  // METHOD 2: If RPC doesn't work, use manual query building
  if (profileError || !profileData) {
    // Fallback: Get trainer and role separately
    const { data: trainerData, error: trainerError } = await supabase
      .from('trainers')
      .select('id, name, rank, region, specialization, status, is_active, created_at, updated_at, last_login, role_id')
      .eq('user_id', user.id)
      .single()

    if (trainerError || !trainerData) {
      console.error('Error fetching trainer data:', trainerError)
      throw new Error('Failed to fetch user profile')
    }

    // Get role data separately
    let roleData = null
    if (trainerData.role_id) {
      const { data: role } = await supabase
        .from('roles')
        .select('id, name, level, description')
        .eq('id', trainerData.role_id)
        .single()
      
      roleData = role
    }

    // Fetch activity statistics
    const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString().split('T')[0]

    const { data: religiousActivities } = await supabase
      .from('religious_activities')
      .select('id')
      .contains('participants', [trainerData.id])

    const { data: physicalTraining } = await supabase
      .from('physical_training')
      .select('id')
      .contains('participants', [trainerData.id])

    const { data: events } = await supabase
      .from('events')
      .select('id')
      .contains('trainer_ids', [trainerData.id])

    const { data: monthlyReligious } = await supabase
      .from('religious_activities')
      .select('id')
      .contains('participants', [trainerData.id])
      .gte('date', firstDayOfMonth)

    const { data: monthlyPT } = await supabase
      .from('physical_training')
      .select('id')
      .contains('participants', [trainerData.id])
      .gte('date', firstDayOfMonth)

    const activityStats = {
      totalReligious: religiousActivities?.length || 0,
      totalPhysicalTraining: physicalTraining?.length || 0,
      totalEvents: events?.length || 0,
      monthlyReligious: monthlyReligious?.length || 0,
      monthlyPhysicalTraining: monthlyPT?.length || 0,
    }

    // Return combined profile data
    return {
      profile: {
        id: trainerData.id,
        name: trainerData.name,
        email: user.email || '',
        role: roleData?.name || 'UNKNOWN',
        roleLevel: roleData?.level || 0,
        roleDescription: roleData?.description || '',
        rank: trainerData.rank || 'Not set',
        region: trainerData.region || 'Not set',
        specialization: trainerData.specialization || 'Not set',
        status: trainerData.status,
        isActive: trainerData.is_active,
        createdAt: trainerData.created_at,
        updatedAt: trainerData.updated_at,
        lastLogin: trainerData.last_login || null,
      },
      activityStats,
    }
  }

  // If RPC worked, return that data (you'd need to format it)
  return profileData
})

export const Route = createFileRoute('/_authed/profile/')({
  loader: async () => await getUserProfile(),
  component: ProfilePage,
})

function ProfilePage() {
  const { profile, activityStats } = Route.useLoaderData()

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header Section */}
      <div className="bg-gradient-to-r from-orange-600 to-red-700 rounded-lg shadow-lg p-5 text-white sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-4 border-white/30 bg-white/20 backdrop-blur-sm sm:h-24 sm:w-24">
            <span className="text-3xl font-bold text-white sm:text-5xl">
              {profile.name?.charAt(0).toUpperCase() || 'U'}
            </span>
          </div>

          <div className="min-w-0 flex-1">
            <h1 className="text-balance text-2xl font-bold sm:text-3xl">
              {profile.role === 'ADMIN' ? 'System Administrator' : profile.name}
            </h1>
            <p className="break-all text-orange-100 sm:text-lg">{profile.email}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
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
              <InfoField label="Email Address" value={profile.email} />
              <InfoField label="Role" value={profile.role} />
              <InfoField label="Rank" value={profile.rank} />
              <InfoField label="Region" value={profile.region} />
              <InfoField label="Specialization" value={profile.specialization} />
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

          {/* Account Security Card */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center">
              <span className="text-3xl mr-3">🔒</span>
              Account Security
            </h2>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 border-2 border-gray-200 rounded-lg hover:border-blue-400 transition">
                <div>
                  <h3 className="font-semibold text-gray-900">Password</h3>
                  <p className="text-sm text-gray-600">Change your password</p>
                </div>
                <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition">
                  Change Password
                </button>
              </div>
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

          {/* Quick Actions Card */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center">
              <span className="text-2xl mr-2">⚡</span>
              Quick Actions
            </h2>
            
            <div className="space-y-2">
              <QuickActionButton to="/schedule" label="View Schedule" icon="📅" />
              <QuickActionButton to="/physical-training" label="PT Sessions" icon="💪" />
              <QuickActionButton to="/religious-activity" label="Religious Activities" icon="📖" />
              {(profile.role === 'ADMIN' || profile.role === 'COORDINATOR') && (
                <QuickActionButton to="/trainer-overview" label="Trainer Overview" icon="👨‍🏫" />
              )}
              <QuickActionButton to="/logout" label="Logout" icon="🚪" color="text-red-600" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Helper Components
function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-gray-600 mb-1">{label}</label>
      <p className="text-base font-medium text-gray-900 bg-gray-50 px-4 py-2 rounded-lg border border-gray-200">
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

function QuickActionButton({ to, label, icon, color = 'text-gray-700' }: { to: string; label: string; icon: string; color?: string }) {
  return (
    <Link
      to={to}
      className={`flex items-center space-x-3 p-3 rounded-lg border-2 border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition ${color}`}
    >
      <span className="text-xl">{icon}</span>
      <span className="font-semibold">{label}</span>
    </Link>
  )
}