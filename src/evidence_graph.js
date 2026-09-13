/**
 * Builds an auditable Evidence Graph establishing the chain of custody:
 * Company -> Domains -> Sources / Pages -> Documents -> People -> Emails -> Departments
 */
function buildEvidenceGraph(companyName, verifiedDomains, crawledPages, documents, acceptedEmails) {
  const nodes = [];
  const edges = [];
  const seenNodes = new Set();

  function addNode(id, type, label, metadata = {}) {
    if (seenNodes.has(id)) return;
    seenNodes.add(id);
    nodes.push({ id, type, label, metadata });
  }

  function addEdge(source, target, relationship, details = '') {
    edges.push({ source, target, relationship, details });
  }

  // 1. Root Company Node
  const companyId = `company:${companyName || 'Corporate Entity'}`;
  addNode(companyId, 'company', companyName || 'Corporate Entity', {
    name: companyName
  });

  // 2. Domain Nodes
  for (const dom of verifiedDomains) {
    const domainId = `domain:${dom.domain}`;
    addNode(domainId, 'domain', dom.domain, {
      type: dom.type,
      status: dom.status,
      evidence: dom.evidence
    });
    addEdge(companyId, domainId, 'OWNS_OR_OPERATES', dom.type);
  }

  // 3. Document Nodes
  for (const doc of documents || []) {
    const docId = `doc:${doc.sha256Hash || doc.url}`;
    addNode(docId, 'document', doc.filename || doc.docTitle || 'Document', {
      url: doc.url,
      sha256Hash: doc.sha256Hash,
      fileSize: doc.fileSize,
      isScanned: doc.isScanned
    });
    addEdge(companyId, docId, 'PUBLISHES_DOCUMENT', 'Corporate Publication');
  }

  // 4. Email & Person Nodes
  for (const item of acceptedEmails) {
    const emailId = `email:${item.email}`;
    addNode(emailId, 'email', item.email, {
      confidenceScore: item.confidenceScore,
      confidenceBadge: item.confidenceBadge,
      department: item.department,
      isRoleAccount: item.isRoleAccount,
      acceptanceReason: item.acceptanceReason
    });

    // Link Domain -> Email
    const emailDomain = item.email.split('@')[1];
    const domNodeId = `domain:${item.verifiedCompanyDomain || emailDomain}`;
    if (seenNodes.has(domNodeId)) {
      addEdge(domNodeId, emailId, 'HOSTS_EMAIL', `Confirmed on ${item.verifiedCompanyDomain}`);
    } else {
      addEdge(companyId, emailId, 'USES_EMAIL', 'Direct communication address');
    }

    // Link Person -> Email (if person discovered)
    if (item.personName) {
      const personId = `person:${item.personName}`;
      addNode(personId, 'person', item.personName, {
        jobTitle: item.jobTitle,
        department: item.department
      });
      addEdge(personId, emailId, 'ASSIGNED_TO_PERSON', item.jobTitle || 'Team Member');
      addEdge(companyId, personId, 'EMPLOYS', item.jobTitle || 'Team Member');
    }

    // Link Source Page -> Email
    if (item.sourceUrl) {
      const sourceId = `source:${item.sourceUrl}`;
      addNode(sourceId, 'source', item.discoveryMethod || 'Website Source', {
        url: item.sourceUrl
      });
      addEdge(sourceId, emailId, 'DISCOVERED_IN', item.discoveryMethod);
    }
  }

  return {
    nodes,
    edges,
    summary: {
      totalEntities: nodes.length,
      totalRelationships: edges.length,
      companiesCount: 1,
      domainsCount: verifiedDomains.length,
      documentsCount: (documents || []).length,
      emailsCount: acceptedEmails.length
    }
  };
}

module.exports = {
  buildEvidenceGraph
};
