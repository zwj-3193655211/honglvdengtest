/**
 * This is a API server
 */

import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express'
import cors from 'cors'
import path from 'path'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import authRoutes from './routes/auth.js'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const requireModule = (path: string) => {
  const mod = require(path)
  return mod && mod.default ? mod.default : mod
}
const intersectionRoutes = requireModule('./routes/intersections.js')
const trafficLightRoutes = requireModule('./routes/trafficLights.js')
const vehicleFlowRoutes = requireModule('./routes/vehicleFlows.js')
const emergencyVehicleRoutes = requireModule('./routes/emergencyVehicles.js')
const settingsRoutes = requireModule('./routes/settings.js')
const trafficAlgorithmRoutes = requireModule('./routes/trafficAlgorithm.js')

// for esm mode
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// load env
dotenv.config()

const app: express.Application = express()

app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

/**
 * API Routes
 */
app.use('/api/auth', authRoutes)
app.use('/api/intersections', intersectionRoutes)
app.use('/api/traffic-lights', trafficLightRoutes)
app.use('/api/vehicle-flows', vehicleFlowRoutes)
app.use('/api/emergency-vehicles', emergencyVehicleRoutes)
app.use('/api/settings', settingsRoutes)
app.use('/api/traffic-algorithm', trafficAlgorithmRoutes)

/**
 * health
 */
app.use(
  '/api/health',
  (req: Request, res: Response, next: NextFunction): void => {
    res.status(200).json({
      success: true,
      message: 'ok',
    })
  },
)

/**
 * error handler middleware
 */
app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
  res.status(500).json({
    success: false,
    error: 'Server internal error',
  })
})

/**
 * 404 handler
 */
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'API not found',
  })
})

export default app
