import React from 'react'
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import { MilestoneTrack } from '../src/modules/dashboard/MilestoneTrack'
const names = ['Building Addition Start', 'Design and Engineering Complete', 'Begin Building Construction', 'Foundation Works Complete', 'Foundation Phase Complete', 'Begin Structural Phase', 'Rough-In Phase Begins', 'Structural Works Complete', 'Structure Complete', 'Building Enclosed', 'Exterior Finishes Complete', 'Rough In Complete', 'Finishes Milestone', 'Mechanical/Electrical Systems Complete', 'Building Addition Complete', 'Building Addition Finish']
const dates = ['02-02','02-24','02-25','05-19','05-19','06-17','08-06','08-10','08-10','10-05','10-05','10-27','12-28','12-28','12-30','12-31']
const milestones = names.map((task_name,i) => ({id:String(i), task_name, finish:`2026-${dates[i]}T08:00:00`,bl_finish:null,is_critical:false,variance_days:0}))
function App() { return <main className="p-6 bg-gray-100 min-h-screen"><section className="bg-white p-4 rounded-lg"><h1 className="font-bold mb-6">Milestone Timeline · crowded dates</h1><MilestoneTrack milestones={milestones} dataDate="2026-02-02" /></section><section className="bg-white p-4 rounded-lg mt-6" style={{width:500}}><h2>Compact widget</h2><MilestoneTrack milestones={milestones} /></section></main> }
createRoot(document.getElementById('root')!).render(<App />)
