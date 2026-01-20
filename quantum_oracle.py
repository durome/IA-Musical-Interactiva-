import json
import time
from qiskit import QuantumCircuit
from qiskit_aer import Aer
from qiskit.compiler import transpile

def generate_quantum_seed(shots=256):
    qc = QuantumCircuit(8, 8)

    # Superposición -> verdadera aleatoriedad cuántica simulada
    qc.h(range(8))
    qc.measure(range(8), range(8))

    backend = Aer.get_backend("aer_simulator")
    compiled = transpile(qc, backend)
    result = backend.run(compiled, shots=shots).result()
    counts = result.get_counts()

    # Elegimos el bitstring más frecuente como "seed"
    seed_bin = max(counts, key=counts.get)
    seed_int = int(seed_bin, 2)

    data = {
        "timestamp": time.time(),
        "seed_binary": seed_bin,
        "seed_int": seed_int,
        "counts": counts
    }

    with open("quantum_seed.json", "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

    print("✅ quantum_seed.json generado:", seed_bin, "=>", seed_int)

if __name__ == "__main__":
    generate_quantum_seed()
