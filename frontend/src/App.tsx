import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api } from './lib/api'
import { useSession } from './lib/session'
import { TopBar } from './components/Chrome'
import { SimpleShell } from './components/Simple'
import { Loading } from './components/ui'
import FaceLogin from './pages/FaceLogin'
import Work from './pages/Work'
import MachineHome from './pages/MachineHome'
import Learn from './pages/Learn'
import GuidePlayer from './pages/GuidePlayer'
import SafetySimple from './pages/SafetySimple'
import Shift from './pages/Shift'
import MachineSelect from './pages/MachineSelect'
import Cockpit from './pages/Cockpit'
import Training from './pages/Training'
import Insights from './pages/Insights'

function RequireAuth() {
  const { operator, ready } = useSession()
  if (!ready) return <Loading />
  if (!operator) return <Navigate to="/login" replace />
  return <Outlet />
}

/** The operator's interface: pictures, voice, one action per screen. */
function Simple() {
  return <SimpleShell><Outlet /></SimpleShell>
}

/** The detailed supervisor view: full telemetry, routing traces, analytics. */
function Pro() {
  const { machineId } = useSession()
  const [label, setLabel] = useState<{ name: string; family: string } | null>(null)
  useEffect(() => {
    if (!machineId) return setLabel(null)
    api.machine(machineId).then((d) => setLabel({ name: d.machine.model, family: d.machine.family })).catch(() => setLabel(null))
  }, [machineId])
  return (
    <div className="min-h-screen">
      <TopBar machineName={label?.name} machineFamily={label?.family} />
      <Outlet />
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<FaceLogin />} />
      <Route element={<RequireAuth />}>
        <Route element={<Simple />}>
          <Route path="/work" element={<Work />} />
          <Route path="/machine" element={<MachineHome />} />
          <Route path="/learn" element={<Learn />} />
          <Route path="/safety" element={<SafetySimple />} />
        </Route>
        <Route path="/guide/:id" element={<GuidePlayer />} />
        <Route path="/pro" element={<Pro />}>
          <Route index element={<Navigate to="cockpit" replace />} />
          <Route path="cockpit" element={<Cockpit />} />
          <Route path="shift" element={<Shift />} />
          <Route path="machines" element={<MachineSelect />} />
          <Route path="training" element={<Training />} />
          <Route path="insights" element={<Insights />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/work" replace />} />
    </Routes>
  )
}
