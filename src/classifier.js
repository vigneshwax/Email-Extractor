function classifyDepartment(email, contextText = '') {
  const local = (email.split('@')[0] || '').toLowerCase();
  const text = (contextText || '').toLowerCase();

  // 1. Procurement & Sourcing
  if (/(procure|purchas|sourcing|vendor|buyer|supply)/i.test(local) || /(procurement department|purchasing manager|vendor relations|sourcing team)/i.test(text)) {
    return {
      department: 'Procurement',
      isExplicit: /(procurement|purchasing|sourcing)/i.test(text)
    };
  }

  // 2. Merchandising
  if (/(merchandis|merch|apparel|retail)/i.test(local) || /(merchandiser|merchandising manager|head of merchandising)/i.test(text)) {
    return {
      department: 'Merchandising',
      isExplicit: /(merchandis|merch)/i.test(text)
    };
  }

  // 3. Investor Relations
  if (/(investor|ir|shareholder|equity|stocks)/i.test(local) || /(investor relations|shareholder services|annual report contact)/i.test(text)) {
    return {
      department: 'Investor Relations',
      isExplicit: /(investor relations|shareholder)/i.test(text)
    };
  }

  // 4. Media & Press
  if (/(press|media|pr|spokesperson|newsroom|journalis)/i.test(local) || /(press contact|media inquiries|press release contact)/i.test(text)) {
    return {
      department: 'Media & Press',
      isExplicit: /(press|media|public relations)/i.test(text)
    };
  }

  // 5. HR & People Operations
  if (/(humanresource|people|personnel|workplace|culture|benefits)/i.test(local) || /(human resources|hr department|people operations)/i.test(text)) {
    return {
      department: 'HR',
      isExplicit: /(human resources|people operations)/i.test(text)
    };
  }

  // 6. Recruitment & Talent
  if (/(recruit|talent|job|career|work|hiring|join|intern|staffing)/i.test(local) || /(recruitment team|join our team|careers department|talent acquisition)/i.test(text)) {
    return {
      department: 'Recruitment',
      isExplicit: /(recruitment|talent acquisition|join our team)/i.test(text)
    };
  }

  // 7. Sales & Business Development
  if (/(sale|bizdev|deal|quote|rfp|commercial|revenue|order|accountmanager)/i.test(local) || /(sales team|get a quote|business development|enterprise sales)/i.test(text)) {
    return {
      department: 'Sales',
      isExplicit: /(sales team|business development)/i.test(text)
    };
  }

  // 8. Marketing & Growth
  if (/(market|brand|comm|editorial|social|growth|campaign)/i.test(local) || /(marketing department|marketing director|brand team)/i.test(text)) {
    return {
      department: 'Marketing',
      isExplicit: /(marketing department|marketing)/i.test(text)
    };
  }

  // 9. Customer Support & Service
  if (/(support|help|care|desk|service|customercare|trouble|ticket|client)/i.test(local) || /(support team|technical support|help desk|customer care)/i.test(text)) {
    return {
      department: 'Customer Support',
      isExplicit: /(support team|customer care|help desk)/i.test(text)
    };
  }

  // 10. Operations
  if (/(ops|operation|logistics|warehouse|facility|shipping|fulfillment)/i.test(local) || /(operations director|head of operations|logistics team)/i.test(text)) {
    return {
      department: 'Operations',
      isExplicit: /(operations|logistics)/i.test(text)
    };
  }

  // 11. Finance & Billing
  if (/(finance|billing|invoice|account|ap|ar|payment|remit|tax|treasury|controller)/i.test(local) || /(accounts payable|invoicing|billing department|finance team)/i.test(text)) {
    return {
      department: 'Finance',
      isExplicit: /(finance department|billing department|accounts payable)/i.test(text)
    };
  }

  // 12. Legal & Privacy
  if (/(legal|privacy|compliance|dpo|gdpr|terms|copyright|counsel|law)/i.test(local) || /(privacy policy|legal counsel|compliance office|data protection)/i.test(text)) {
    return {
      department: 'Legal',
      isExplicit: /(legal counsel|privacy policy|data protection)/i.test(text)
    };
  }

  // 13. Management & Executive
  if (/(ceo|founder|president|exec|director|vp|board|chief|management|cfo|cto|coo|cro)/i.test(local) || /(executive team|board of directors|management office|founder)/i.test(text)) {
    return {
      department: 'Executive',
      isExplicit: /(executive|director|founder|ceo)/i.test(text)
    };
  }

  // 14. IT & Technical
  if (/(tech|dev|engineering|webmaster|admin|postmaster|abuse|security|noc|sysadmin|host|developer)/i.test(local) || /(engineering team|webmaster|technical team|systems administrator)/i.test(text)) {
    return {
      department: 'IT & Technical',
      isExplicit: /(engineering team|technical team|developer)/i.test(text)
    };
  }

  return {
    department: 'General',
    isExplicit: false
  };
}

module.exports = {
  classifyDepartment
};
