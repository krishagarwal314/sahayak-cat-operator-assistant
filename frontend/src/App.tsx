import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api } from './lib/api'
import { useSession } from './lib/session'
import { TopBar } from './components/Chrome'
import { Loading } from './components/ui'
import Login from './pages/Login'
import Shift from './pages/Shift'
import MachineSelect from './pages/MachineSelect'
import Cockpit from './pages/Cockpit'
import Training from './pages/Training'
import Insights from './pages/Insights'

function Shell() {
  const { operator, machineId, ready } = useSession()
  const [machineLabel, setMachineLabel] = useState<{ name: string; family: string } | null>(null)

  useEffect(() => {
    if (!machineId) {
      setMachineLabel(null)
      return
    }
    api.machine(machineId)
      .then((detail) => setMachineLabel({ name: detail.machine.model, family: detail.machine.family }))
      .catch(() => setMachineLabel(null))
  }, [machineId])

  if (!ready) return <Loading />
  if (!operator) return <Navigate to="/login" replace />

  return (
    <div className="min-h-screen">
      <TopBar machineName={machineLabel?.name} machineFamily={machineLabel?.family} />
      <Outlet />
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Shell />}>
        <Route path="/shift" element={<Shift />} />
        <Route path="/machines" element={<MachineSelect />} />
        <Route path="/cockpit" element={<Cockpit />} />
        <Route path="/training" element={<Training />} />
        <Route path="/insights" element={<Insights />} />
      </Route>
      <Route path="*" element={<Navigate to="/shift" replace />} />
    </Routes>
  )
}
