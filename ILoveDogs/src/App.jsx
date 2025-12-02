import PetMaps from './components/PetMaps'

export default function App() {
  return (
    <div style={{ padding: 16 }}>
      <h1>Adoptable Pets — Maps</h1>
      <p>Heatmap of concentrations, nearest adoptable pets, and clustered intake/found locations.</p>
      <PetMaps />
    </div>
  )
}
