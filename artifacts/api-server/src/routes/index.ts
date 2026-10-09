import { Router, type IRouter } from "express";
import healthRouter from "./health";
import scrapCookRouter from "./scrapcook";
import scanIngredientsRouter from "./scan-ingredients";

const router: IRouter = Router();

router.use(healthRouter);
router.use(scrapCookRouter);
router.use(scanIngredientsRouter);

export default router;
