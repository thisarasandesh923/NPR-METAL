import type { Request, Response } from "express";
import type { ReportsService } from "./reports.service.js";

export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  overview = async (_req: Request, res: Response): Promise<void> => {
    const overview = await this.reportsService.getOverview();
    res.status(200).json({
      success: true,
      data: { overview },
    });
  };
}
