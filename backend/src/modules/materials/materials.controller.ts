import type { Request, Response } from "express";
import type { MaterialsService } from "./materials.service.js";

export class MaterialsController {
  constructor(private readonly materialsService: MaterialsService) {}

  listActive = async (_req: Request, res: Response): Promise<void> => {
    const materials = await this.materialsService.getActiveMaterials();
    res.status(200).json({
      success: true,
      data: { materials },
    });
  };
}
