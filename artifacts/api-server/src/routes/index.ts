import { Router, type IRouter } from "express";
import healthRouter from "./health";
import scrapCookRouter from "./scrapcook";
import scanIngredientsRouter from "./scan-ingredients";
import chefBillingRouter from "./chef-billing";

const router: IRouter = Router();

router.use(healthRouter);
router.use(chefBillingRouter);
router.use(scrapCookRouter);
router.use(scanIngredientsRouter);

export default router;
