
const createTrackingKey = (activity: any, location: any, action: any) => {
   const normalizedActivity = (activity || "").trim().toLowerCase();
   const normalizedLocation = (location || "").trim().toLowerCase();
   const normalizedAction = (action || "").trim().toLowerCase();

   // Create a composite key without timestamp
   return `${normalizedActivity}|${normalizedLocation}|${normalizedAction}`;
};

const removeDuplicateStages = (order: any) => {
   if (!order.orderStages || !Array.isArray(order.orderStages)) {
      order.orderStages = [];
      return order;
   }

   // Create a map to track unique stages
   const uniqueStages = new Map();
   const deduplicatedStages = [];

   // Process each stage
   for (const stage of order.orderStages) {
      const trackingKey = createTrackingKey(
         stage.activity,
         stage.location,
         stage.action || stage.statusCode || ''
      );

      // Only keep stages with unique tracking keys
      if (!uniqueStages.has(trackingKey)) {
         uniqueStages.set(trackingKey, true);
         deduplicatedStages.push(stage);
      }
   }

   // Sort stages by date
   deduplicatedStages.sort((a, b) => {
      const dateA = new Date(a.stageDateTime).getTime() || 0;
      const dateB = new Date(b.stageDateTime).getTime() || 0;
      return dateA - dateB;
   });

   order.orderStages = deduplicatedStages;
   return order;
};

const stageExists = (order: any, activity: any, location: any, action: any) => {
   if (!order.orderStages || !Array.isArray(order.orderStages)) {
      return false;
   }

   const trackingKey = createTrackingKey(activity, location, action);

   // Create a set of existing tracking keys
   const existingKeys = order.orderStages.map((stage: any) =>
      createTrackingKey(
         stage.activity,
         stage.location,
         stage.action || stage.statusCode || ''
      )
   );

   return existingKeys.includes(trackingKey);
};

const buildExistingStagesMap = (orderStages: any) => {
   const existingStagesMap = new Map();

   if (!orderStages || !Array.isArray(orderStages)) {
      return existingStagesMap;
   }

   orderStages.forEach(stage => {
      const key = createTrackingKey(
         stage.activity,
         stage.location,
         stage.action || stage.statusCode || ''
      );
      existingStagesMap.set(key, true);
   });

   return existingStagesMap;
};

export {
   createTrackingKey,
   removeDuplicateStages,
   stageExists,
   buildExistingStagesMap
};