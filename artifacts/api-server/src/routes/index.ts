import { Router, type IRouter } from "express";
import healthRouter from "./health";
import scrapCookRouter from "./scrapcook";

const router: IRouter = Router();

router.use(healthRouter);
router.use(scrapCookRouter);

export default router;
